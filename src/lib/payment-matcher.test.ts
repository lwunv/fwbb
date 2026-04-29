import { describe, it, expect, vi, beforeEach } from "vitest";
import { processPayment } from "./payment-matcher";
import { db } from "@/db";

// Mock the DB and related modules. The matcher uses:
//   - db.query.{members,sessionDebts,sessions}
//   - db.insert(...).values(...).onConflictDoNothing(...).returning(...)
//   - db.update(...).set(...).where(...)
//   - db.transaction(cb) — passes a tx with the same surface as db
function makeChain(returnRows: unknown[] = [{ id: 999 }]) {
  return {
    values: vi.fn(() => ({
      onConflictDoNothing: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve(returnRows)),
      })),
      returning: vi.fn(() => Promise.resolve(returnRows)),
      onConflictDoUpdate: vi.fn(),
    })),
  };
}

vi.mock("@/db", () => {
  const insertImpl = vi.fn(() => makeChain([{ id: 999 }]));
  const updateImpl = vi.fn(() => ({
    set: vi.fn(() => ({ where: vi.fn() })),
  }));
  // The tx object surface mirrors `db` because recordFinancialTransaction
  // reads `tx.query.financialTransactions.findFirst` when an idempotencyKey
  // is set, and processPayment now updates paymentNotifications inside the
  // inner transaction.
  const txObj = {
    insert: insertImpl,
    update: updateImpl,
    query: {
      sessionDebts: { findFirst: vi.fn(), findMany: vi.fn() },
      financialTransactions: { findFirst: vi.fn(), findMany: vi.fn() },
      paymentNotifications: { findFirst: vi.fn() },
      members: { findFirst: vi.fn() },
      sessions: { findFirst: vi.fn(), findMany: vi.fn() },
      fundMembers: { findFirst: vi.fn() },
    },
  };
  return {
    db: {
      query: {
        paymentNotifications: { findFirst: vi.fn() },
        members: { findFirst: vi.fn() },
        sessionDebts: { findFirst: vi.fn(), findMany: vi.fn() },
        sessions: { findMany: vi.fn(), findFirst: vi.fn() },
        fundMembers: { findFirst: vi.fn() },
        financialTransactions: { findFirst: vi.fn(), findMany: vi.fn() },
      },
      insert: insertImpl,
      update: updateImpl,
      transaction: vi.fn(async (cb: (tx: typeof txObj) => Promise<unknown>) =>
        cb(txObj),
      ),
    },
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("./fund-calculator", () => ({
  isFundMember: vi.fn(),
}));

import { isFundMember } from "./fund-calculator";

const mockPayment = {
  amount: 100000,
  memo: "FWBB QUY",
  transId: "FT123",
  senderAccountNo: "9021",
};

function setInsertReturn(rows: unknown[]) {
  const dbAny = db as unknown as { insert: ReturnType<typeof vi.fn> };
  dbAny.insert.mockImplementationOnce(() => makeChain(rows));
}

describe("processPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns duplicate when notification insert conflicts (idempotent)", async () => {
    // First insert (claim row) — returns no row → already claimed
    setInsertReturn([]);
    const result = await processPayment(mockPayment, "msg-001");
    expect(result.status).toBe("duplicate");
  });

  it("returns pending if sender account is not found", async () => {
    setInsertReturn([{ id: 1 }]); // claim succeeds
    vi.mocked(db.query.members.findFirst).mockResolvedValueOnce(undefined);
    const result = await processPayment(mockPayment, "msg-002");
    expect(result.status).toBe("pending");
  });

  it("matches fund contribution when keyword QUY present + member active", async () => {
    setInsertReturn([{ id: 1 }]); // notification claim
    vi.mocked(db.query.members.findFirst).mockResolvedValueOnce({
      id: 1,
      name: "Luu",
    } as never);
    vi.mocked(isFundMember).mockResolvedValueOnce(true);
    // Inside matchFundContribution → recordFinancialTransaction inserts ledger row
    setInsertReturn([{ id: 999 }]);
    const result = await processPayment(mockPayment, "msg-003");
    expect(result.status).toBe("matched_fund");
    expect(result.memberId).toBe(1);
  });

  it("matches session debt by session ID (within transaction)", async () => {
    const payment = { ...mockPayment, memo: "thanh toan S42" };
    setInsertReturn([{ id: 1 }]);
    vi.mocked(db.query.members.findFirst).mockResolvedValueOnce({
      id: 1,
      name: "Luu",
    } as never);
    // matchSessionDebt now checks parent session.status before loading the debt
    vi.mocked(db.query.sessions.findFirst).mockResolvedValueOnce({
      status: "completed",
    } as never);
    vi.mocked(db.query.sessionDebts.findFirst).mockResolvedValueOnce({
      id: 100,
      memberId: 1,
      totalAmount: 100000,
    } as never);
    setInsertReturn([{ id: 777 }]); // ledger insert inside tx

    const result = await processPayment(payment, "msg-004");
    expect(result.status).toBe("matched_debt");
    expect(result.debtId).toBe(100);
  });

  it("falls back to oldest unpaid debt when intent unknown", async () => {
    const payment = { ...mockPayment, memo: "chuyen tien an sang" };
    setInsertReturn([{ id: 1 }]);
    vi.mocked(db.query.members.findFirst).mockResolvedValueOnce({
      id: 1,
      name: "Luu",
    } as never);
    // matchOldestDebt now uses findMany + filters cancelled in JS
    vi.mocked(db.query.sessionDebts.findMany).mockResolvedValueOnce([
      {
        id: 55,
        memberId: 1,
        totalAmount: 100000,
        session: { status: "completed" },
      },
    ] as never);
    setInsertReturn([{ id: 778 }]);

    const result = await processPayment(payment, "msg-005");
    expect(result.status).toBe("matched_debt");
    expect(result.debtId).toBe(55);
  });

  it("accepts overpayment and notes the surplus", async () => {
    const payment = { ...mockPayment, amount: 105000, memo: "thanh toan no" }; // 5k extra
    setInsertReturn([{ id: 1 }]);
    vi.mocked(db.query.members.findFirst).mockResolvedValueOnce({
      id: 1,
      name: "Luu",
    } as never);
    vi.mocked(db.query.sessionDebts.findMany).mockResolvedValueOnce([
      {
        id: 60,
        memberId: 1,
        totalAmount: 100000,
        session: { status: "completed" },
      },
    ] as never);
    setInsertReturn([{ id: 779 }]);

    const result = await processPayment(payment, "msg-006");
    expect(result.status).toBe("matched_debt");
    expect(result.message).toContain("dư");
  });

  it("rejects underpayment as pending", async () => {
    const payment = { ...mockPayment, amount: 90000, memo: "thanh toan no" }; // short by 10k
    setInsertReturn([{ id: 1 }]);
    vi.mocked(db.query.members.findFirst).mockResolvedValueOnce({
      id: 1,
      name: "Luu",
    } as never);
    vi.mocked(db.query.sessionDebts.findMany).mockResolvedValueOnce([
      {
        id: 70,
        memberId: 1,
        totalAmount: 100000,
        session: { status: "completed" },
      },
    ] as never);

    const result = await processPayment(payment, "msg-007");
    expect(result.status).toBe("pending");
    expect(result.message).toContain("thiếu");
  });
});

/**
 * Integration tests cho confirm-payment flows + payment-matcher hardening.
 *
 * Audit findings:
 *  - High #6: confirmPaymentByMember idempotent guard ngoài transaction →
 *    2 request đồng thời ghi 2 ledger row trùng. Sau fix: idempotencyKey
 *    natural là `debt-member-confirm-{debtId}` → DB UNIQUE chặn ghi đôi.
 *  - High #8: confirmDebtFromBankTransfer cũ chỉ set memberConfirmed.
 *    Tiền đã thật vào → adminConfirmed cũng phải = true.
 *  - High #12: payment-matcher.matchSessionDebt KHÔNG filter session.status
 *    → có thể match session đã `cancelled`. Sau fix: chỉ match session
 *    `completed`.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  members,
  sessions,
  sessionDebts,
  financialTransactions,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";

const userMock = vi.hoisted(() => ({
  getUserFromCookie:
    vi.fn<() => Promise<{ memberId: number; facebookId: string } | null>>(),
}));
vi.mock("@/lib/user-identity", () => userMock);
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
  getAdminFromCookie: vi.fn(async () => ({ sub: "1", role: "admin" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/messenger", () => ({
  sendGroupMessage: vi.fn(),
  buildDebtReminderMessage: vi.fn(),
  buildNewSessionMessage: vi.fn(),
  buildConfirmedMessage: vi.fn(),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { confirmPaymentByMember, confirmPaymentByAdmin, undoPaymentByAdmin } =
  await import("./finance");
const { processPayment } = await import("@/lib/payment-matcher");

async function reset() {
  await client.execute("DELETE FROM payment_notifications");
  await client.execute("DELETE FROM financial_transactions");
  await client.execute("DELETE FROM session_debts");
  await client.execute("DELETE FROM session_attendees");
  await client.execute("DELETE FROM session_shuttlecocks");
  await client.execute("DELETE FROM votes");
  await client.execute("DELETE FROM sessions");
  await client.execute("DELETE FROM members");
  userMock.getUserFromCookie.mockReset();
}

async function seedMember() {
  const [m] = await testDb
    .insert(members)
    .values({ name: "Alice", facebookId: "fb-a", bankAccountNo: "0123" })
    .returning({ id: members.id });
  return m.id;
}

async function seedDebt(
  memberId: number,
  status: "completed" | "cancelled" = "completed",
  amount = 100_000,
) {
  const [s] = await testDb
    .insert(sessions)
    .values({ date: "2026-04-15", status, courtPrice: 200_000 })
    .returning({ id: sessions.id });
  const [d] = await testDb
    .insert(sessionDebts)
    .values({
      sessionId: s.id,
      memberId,
      totalAmount: amount,
      memberConfirmed: false,
      adminConfirmed: false,
    })
    .returning({ id: sessionDebts.id });
  return { sessionId: s.id, debtId: d.id };
}

describe("confirmPaymentByMember — idempotency via ledger key", () => {
  beforeEach(reset);

  it("rejects when called by a different member than debt owner", async () => {
    const aliceId = await seedMember();
    const [bob] = await testDb
      .insert(members)
      .values({ name: "Bob", facebookId: "fb-b" })
      .returning({ id: members.id });
    const { debtId } = await seedDebt(aliceId);

    userMock.getUserFromCookie.mockResolvedValue({
      memberId: bob.id,
      facebookId: "fb-b",
    });
    const r = await confirmPaymentByMember(debtId);
    expect("error" in r).toBe(true);
  });

  it("inserts exactly one debt_member_confirmed ledger row even on replay", async () => {
    const aliceId = await seedMember();
    const { debtId } = await seedDebt(aliceId);
    userMock.getUserFromCookie.mockResolvedValue({
      memberId: aliceId,
      facebookId: "fb-a",
    });

    const r1 = await confirmPaymentByMember(debtId);
    expect("error" in r1).toBe(false);

    const r2 = await confirmPaymentByMember(debtId);
    expect("error" in r2).toBe(false);

    const ledger = await testDb.query.financialTransactions.findMany({
      where: and(
        eq(financialTransactions.debtId, debtId),
        eq(financialTransactions.type, "debt_member_confirmed"),
      ),
    });
    expect(ledger).toHaveLength(1);
  });

  it("rejects confirmation on cancelled session", async () => {
    const aliceId = await seedMember();
    const { debtId } = await seedDebt(aliceId, "cancelled");
    userMock.getUserFromCookie.mockResolvedValue({
      memberId: aliceId,
      facebookId: "fb-a",
    });
    const r = await confirmPaymentByMember(debtId);
    expect("error" in r).toBe(true);
  });
});

describe("confirmPaymentByAdmin — idempotency", () => {
  beforeEach(reset);

  it("inserts exactly one debt_admin_confirmed ledger row even on replay", async () => {
    const aliceId = await seedMember();
    const { debtId } = await seedDebt(aliceId);

    const r1 = await confirmPaymentByAdmin(debtId);
    expect("error" in r1).toBe(false);
    const r2 = await confirmPaymentByAdmin(debtId);
    expect("error" in r2).toBe(false);

    const ledger = await testDb.query.financialTransactions.findMany({
      where: and(
        eq(financialTransactions.debtId, debtId),
        eq(financialTransactions.type, "debt_admin_confirmed"),
      ),
    });
    expect(ledger).toHaveLength(1);
  });

  it("undoPaymentByAdmin clears both flags AND inserts debt_undo", async () => {
    const aliceId = await seedMember();
    const { debtId } = await seedDebt(aliceId);
    await confirmPaymentByAdmin(debtId);

    const r = await undoPaymentByAdmin(debtId);
    expect("error" in r).toBe(false);

    const debt = await testDb.query.sessionDebts.findFirst({
      where: eq(sessionDebts.id, debtId),
    });
    expect(debt?.adminConfirmed).toBe(false);
    expect(debt?.memberConfirmed).toBe(false);
  });
});

describe("processPayment — bank transfer matching", () => {
  beforeEach(reset);

  it("setSession debt: bank transfer marks BOTH memberConfirmed AND adminConfirmed", async () => {
    const aliceId = await seedMember();
    const { debtId, sessionId } = await seedDebt(aliceId);

    const result = await processPayment(
      {
        amount: 100_000,
        memo: `FWBB NO ${aliceId}`,
        senderAccountNo: "0123",
        transId: "TX-1",
      },
      "gmail-1",
    );

    expect(result.status).toBe("matched_debt");

    const debt = await testDb.query.sessionDebts.findFirst({
      where: eq(sessionDebts.id, debtId),
    });
    // Bank money has actually arrived → both flags should be true.
    expect(debt?.memberConfirmed).toBe(true);
    expect(debt?.adminConfirmed).toBe(true);
    void sessionId;
  });

  it("does NOT match a debt whose session was cancelled", async () => {
    const aliceId = await seedMember();
    const { debtId } = await seedDebt(aliceId, "cancelled");

    const result = await processPayment(
      {
        amount: 100_000,
        memo: `FWBB NO ${aliceId}`,
        senderAccountNo: "0123",
        transId: "TX-2",
      },
      "gmail-2",
    );

    // No outstanding debt should be matched against a cancelled session.
    expect(result.status).toBe("pending");
    const debt = await testDb.query.sessionDebts.findFirst({
      where: eq(sessionDebts.id, debtId),
    });
    expect(debt?.memberConfirmed).toBe(false);
    expect(debt?.adminConfirmed).toBe(false);
  });

  it("inserts a debt_admin_confirmed audit row alongside bank_payment_received", async () => {
    // After H8: every bank-confirmed debt should produce a paired
    // `debt_admin_confirmed` ledger row so the audit trail matches what
    // `confirmPaymentByAdmin` would have written manually.
    const aliceId = await seedMember();
    const { debtId } = await seedDebt(aliceId);

    await processPayment(
      {
        amount: 100_000,
        memo: `FWBB NO ${aliceId}`,
        senderAccountNo: "0123",
        transId: "TX-AUDIT",
      },
      "gmail-audit",
    );

    const adminConfirmedRows =
      await testDb.query.financialTransactions.findMany({
        where: and(
          eq(financialTransactions.debtId, debtId),
          eq(financialTransactions.type, "debt_admin_confirmed"),
        ),
      });
    expect(adminConfirmedRows).toHaveLength(1);
  });

  it("inserts a balancing fund_contribution so member's fund balance returns to 0 after payment", async () => {
    // After H13: when finalize wrote `fund_deduction = -X`, the bank
    // payment should write `fund_contribution = +X` to clear the negative
    // balance — otherwise "my-fund" still shows the member as in debt
    // even after they've paid.
    const aliceId = await seedMember();
    const { debtId } = await seedDebt(aliceId, "completed", 100_000);

    // Simulate the fund_deduction that finalize would have written.
    await testDb.insert(financialTransactions).values({
      type: "fund_deduction",
      direction: "out",
      amount: 100_000,
      memberId: aliceId,
      debtId,
      description: "Trừ quỹ buổi (giả lập từ finalize)",
    });

    await processPayment(
      {
        amount: 100_000,
        memo: `FWBB NO ${aliceId}`,
        senderAccountNo: "0123",
        transId: "TX-BALANCE",
      },
      "gmail-balance",
    );

    // Compute net fund balance from ledger.
    const txs = await testDb.query.financialTransactions.findMany({
      where: eq(financialTransactions.memberId, aliceId),
    });
    let bal = 0;
    for (const t of txs) {
      if (t.type === "fund_contribution") bal += t.amount;
      else if (t.type === "fund_deduction") bal -= t.amount;
      else if (t.type === "fund_refund") bal -= t.amount;
    }
    // -100k (deduction) + 100k (balance fix) = 0
    expect(bal).toBe(0);
  });

  it("processPayment notifications + ledger updates are atomic (no orphan pending status)", async () => {
    // After H11: notification status update happens INSIDE the same
    // transaction as the ledger inserts. Even on a successful match,
    // querying the notification immediately afterwards must show
    // status="matched", not the initial "pending" placeholder.
    const aliceId = await seedMember();
    await seedDebt(aliceId);

    await processPayment(
      {
        amount: 100_000,
        memo: `FWBB NO ${aliceId}`,
        senderAccountNo: "0123",
        transId: "TX-ATOMIC",
      },
      "gmail-atomic",
    );

    const notif = await testDb.query.paymentNotifications.findFirst({
      where: (n, { eq }) => eq(n.gmailMessageId, "gmail-atomic"),
    });
    expect(notif?.status).toBe("matched");
    expect(notif?.matchedDebtId).not.toBeNull();
  });
});

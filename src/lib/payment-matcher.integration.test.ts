/**
 * Integration tests cho `processPayment` chạy trên DB thật:
 *  - Idempotency qua UNIQUE gmail_message_id
 *  - Match fund contribution (memo "QUY {id}", "QUY", QUY+sender)
 *  - Match all-debts (memo "NO {id}") — atomically confirms tất cả nợ
 *  - Match session-debt theo S{id} và theo DD/MM
 *  - Fall back to oldest debt khi memo unknown
 *  - Pending khi sender không xác định, member không phải fund member,
 *    không có nợ, hoặc số tiền thiếu
 *  - Bulk pay với overpayment
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  members,
  fundMembers,
  sessions,
  sessionDebts,
  financialTransactions,
  paymentNotifications,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { processPayment } = await import("./payment-matcher");

async function reset() {
  await client.execute("DELETE FROM payment_notifications");
  await client.execute("DELETE FROM financial_transactions");
  await client.execute("DELETE FROM session_debts");
  await client.execute("DELETE FROM session_attendees");
  await client.execute("DELETE FROM session_shuttlecocks");
  await client.execute("DELETE FROM votes");
  await client.execute("DELETE FROM sessions");
  await client.execute("DELETE FROM fund_members");
  await client.execute("DELETE FROM members");
}

let counter = 0;
async function seedMember(opts?: { name?: string; bankAccountNo?: string }) {
  counter += 1;
  const [m] = await testDb
    .insert(members)
    .values({
      name: opts?.name ?? `Member${counter}`,
      facebookId: `fb-${counter}-${Date.now()}`,
      bankAccountNo: opts?.bankAccountNo ?? null,
    })
    .returning({ id: members.id });
  return m.id;
}

async function joinFund(memberId: number) {
  await testDb
    .insert(fundMembers)
    .values({ memberId, isActive: true })
    .onConflictDoNothing();
}

async function seedSession(date = "2026-04-10") {
  const [s] = await testDb
    .insert(sessions)
    .values({ date, status: "completed", courtPrice: 200_000 })
    .returning({ id: sessions.id });
  return s.id;
}

async function seedDebt(
  sessionId: number,
  memberId: number,
  total: number,
  confirmed = false,
) {
  const [d] = await testDb
    .insert(sessionDebts)
    .values({
      sessionId,
      memberId,
      totalAmount: total,
      memberConfirmed: confirmed,
    })
    .returning({ id: sessionDebts.id });
  return d.id;
}

const basePayment = (overrides: Partial<Record<string, unknown>> = {}) => ({
  amount: 100_000,
  memo: "",
  transId: "FT123",
  senderAccountNo: null as string | null,
  ...overrides,
});

describe("processPayment (integration)", () => {
  beforeEach(async () => {
    await reset();
  });

  // ─── Idempotency ───

  it("returns duplicate when same gmail_message_id processed twice", async () => {
    const memberId = await seedMember({ bankAccountNo: "9021" });
    await joinFund(memberId);
    const payment = basePayment({
      amount: 200_000,
      memo: `FWBB QUY ${memberId}`,
      transId: "FT-DUP",
    });

    const r1 = await processPayment(payment as never, "msg-dup");
    expect(r1.status).toBe("matched_fund");

    const r2 = await processPayment(payment as never, "msg-dup");
    expect(r2.status).toBe("duplicate");

    // Only 1 fund_contribution + 1 notification persisted
    const notifs = await testDb.query.paymentNotifications.findMany({});
    expect(notifs).toHaveLength(1);
    const txs = await testDb.query.financialTransactions.findMany({
      where: eq(financialTransactions.type, "fund_contribution"),
    });
    expect(txs).toHaveLength(1);
  });

  // ─── Fund contribution ───

  it("matches QUY {id} memo even without senderAccountNo", async () => {
    const m = await seedMember();
    await joinFund(m);
    const r = await processPayment(
      basePayment({
        amount: 500_000,
        memo: `FWBB QUY ${m}`,
        senderAccountNo: null,
      }) as never,
      "msg-quy-id",
    );
    expect(r.status).toBe("matched_fund");
    expect(r.memberId).toBe(m);

    const txs = await testDb.query.financialTransactions.findMany({
      where: eq(financialTransactions.type, "fund_contribution"),
    });
    expect(txs[0].amount).toBe(500_000);
    expect(txs[0].memberId).toBe(m);
  });

  it("matches plain QUY keyword via senderAccountNo lookup", async () => {
    const m = await seedMember({ bankAccountNo: "8888777766" });
    await joinFund(m);
    const r = await processPayment(
      basePayment({
        amount: 300_000,
        memo: "DONG QUY THANG 4",
        senderAccountNo: "8888777766",
      }) as never,
      "msg-quy-bank",
    );
    expect(r.status).toBe("matched_fund");
    expect(r.memberId).toBe(m);
  });

  it("returns pending if member is not in fund", async () => {
    await seedMember({ bankAccountNo: "1111" });
    // Not joined fund
    const r = await processPayment(
      basePayment({
        amount: 200_000,
        memo: "QUY",
        senderAccountNo: "1111",
      }) as never,
      "msg-not-fund",
    );
    expect(r.status).toBe("pending");

    const txs = await testDb.query.financialTransactions.findMany({});
    expect(txs).toHaveLength(0);

    const notifs = await testDb.query.paymentNotifications.findMany({});
    expect(notifs[0].status).toBe("pending");
  });

  it("returns pending when no member can be identified", async () => {
    const r = await processPayment(
      basePayment({
        amount: 100_000,
        memo: "chuyen tien",
      }) as never,
      "msg-no-id",
    );
    expect(r.status).toBe("pending");
  });

  // ─── All-debts (NO memberId) ───

  it("clears all unpaid debts on memo NO {id} when amount >= total", async () => {
    const m = await seedMember();
    const s1 = await seedSession("2026-04-01");
    const s2 = await seedSession("2026-04-08");
    const s3 = await seedSession("2026-04-15");
    const d1 = await seedDebt(s1, m, 100_000);
    const d2 = await seedDebt(s2, m, 200_000);
    const d3 = await seedDebt(s3, m, 50_000);

    const r = await processPayment(
      basePayment({
        amount: 350_000,
        memo: `FWBB NO ${m}`,
      }) as never,
      "msg-no-all",
    );
    expect(r.status).toBe("matched_debt");
    expect(r.memberId).toBe(m);
    expect(r.debtId).toBe(d1); // first oldest

    // All 3 debts confirmed
    for (const id of [d1, d2, d3]) {
      const d = await testDb.query.sessionDebts.findFirst({
        where: eq(sessionDebts.id, id),
      });
      expect(d?.memberConfirmed).toBe(true);
    }

    // 3 bank_payment_received entries
    const txs = await testDb.query.financialTransactions.findMany({
      where: eq(financialTransactions.type, "bank_payment_received"),
    });
    expect(txs).toHaveLength(3);
    const totalRecorded = txs.reduce((s, t) => s + t.amount, 0);
    expect(totalRecorded).toBe(350_000);
  });

  it("rejects underpayment for NO {id} bulk", async () => {
    const m = await seedMember();
    const s1 = await seedSession("2026-04-01");
    const s2 = await seedSession("2026-04-08");
    await seedDebt(s1, m, 100_000);
    await seedDebt(s2, m, 200_000);

    const r = await processPayment(
      basePayment({
        amount: 100_000, // short
        memo: `FWBB NO ${m}`,
      }) as never,
      "msg-no-short",
    );
    expect(r.status).toBe("pending");
    expect(r.message).toContain("thiếu");

    // No debts confirmed, no ledger
    const debts = await testDb.query.sessionDebts.findMany({
      where: eq(sessionDebts.memberId, m),
    });
    for (const d of debts) {
      expect(d.memberConfirmed).toBe(false);
    }
    const txs = await testDb.query.financialTransactions.findMany({});
    expect(txs).toHaveLength(0);
  });

  it("treats NO {id} as fund contribution when no debts and member is fund member", async () => {
    const m = await seedMember();
    await joinFund(m);
    const r = await processPayment(
      basePayment({
        amount: 200_000,
        memo: `FWBB NO ${m}`,
      }) as never,
      "msg-no-empty",
    );
    expect(r.status).toBe("matched_fund");
    expect(r.memberId).toBe(m);
  });

  it("returns pending when NO {id} has no debts and member is NOT fund member", async () => {
    const m = await seedMember();
    const r = await processPayment(
      basePayment({
        amount: 200_000,
        memo: `FWBB NO ${m}`,
      }) as never,
      "msg-no-empty-2",
    );
    expect(r.status).toBe("pending");
  });

  // ─── Single session debt by S{id} ───

  it("matches a specific session debt by S{id}", async () => {
    const m = await seedMember({ bankAccountNo: "5555" });
    const sId = await seedSession();
    const debtId = await seedDebt(sId, m, 100_000);

    const r = await processPayment(
      basePayment({
        amount: 100_000,
        memo: `thanh toan S${sId}`,
        senderAccountNo: "5555",
      }) as never,
      "msg-s-id",
    );
    expect(r.status).toBe("matched_debt");
    expect(r.debtId).toBe(debtId);

    const d = await testDb.query.sessionDebts.findFirst({
      where: eq(sessionDebts.id, debtId),
    });
    expect(d?.memberConfirmed).toBe(true);
  });

  it("matches session debt by date pattern DD/MM", async () => {
    const m = await seedMember({ bankAccountNo: "5555" });
    const sId = await seedSession("2026-04-15");
    const debtId = await seedDebt(sId, m, 100_000);

    const r = await processPayment(
      basePayment({
        amount: 100_000,
        memo: "BUOI 15/04",
        senderAccountNo: "5555",
      }) as never,
      "msg-date",
    );
    expect(r.status).toBe("matched_debt");
    expect(r.debtId).toBe(debtId);
  });

  it("rejects S{id} match if amount underpays", async () => {
    const m = await seedMember({ bankAccountNo: "5555" });
    const sId = await seedSession();
    const debtId = await seedDebt(sId, m, 200_000);

    const r = await processPayment(
      basePayment({
        amount: 100_000,
        memo: `S${sId}`,
        senderAccountNo: "5555",
      }) as never,
      "msg-s-short",
    );
    expect(r.status).toBe("pending");
    expect(r.message).toContain("thiếu");

    const d = await testDb.query.sessionDebts.findFirst({
      where: eq(sessionDebts.id, debtId),
    });
    expect(d?.memberConfirmed).toBe(false);
  });

  it("accepts overpayment and notes 'dư' in message", async () => {
    const m = await seedMember({ bankAccountNo: "5555" });
    const sId = await seedSession();
    const debtId = await seedDebt(sId, m, 100_000);

    const r = await processPayment(
      basePayment({
        amount: 105_000, // 5k extra
        memo: `S${sId}`,
        senderAccountNo: "5555",
      }) as never,
      "msg-over",
    );
    expect(r.status).toBe("matched_debt");
    expect(r.message.toLowerCase()).toContain("dư");

    const d = await testDb.query.sessionDebts.findFirst({
      where: eq(sessionDebts.id, debtId),
    });
    expect(d?.memberConfirmed).toBe(true);
  });

  // ─── Oldest-debt fallback ───

  it("falls back to oldest unpaid debt when memo unknown but sender matches", async () => {
    const m = await seedMember({ bankAccountNo: "5555" });
    const s1 = await seedSession("2026-04-01");
    const s2 = await seedSession("2026-04-08");
    const oldestDebt = await seedDebt(s1, m, 100_000);
    const newerDebt = await seedDebt(s2, m, 100_000);

    const r = await processPayment(
      basePayment({
        amount: 100_000,
        memo: "chuyen khoan",
        senderAccountNo: "5555",
      }) as never,
      "msg-fallback-oldest",
    );
    expect(r.status).toBe("matched_debt");
    expect(r.debtId).toBe(oldestDebt);

    // Newer debt untouched
    const newer = await testDb.query.sessionDebts.findFirst({
      where: eq(sessionDebts.id, newerDebt),
    });
    expect(newer?.memberConfirmed).toBe(false);
  });

  it("treats unknown memo + no debts + fund member as fund contribution", async () => {
    const m = await seedMember({ bankAccountNo: "5555" });
    await joinFund(m);
    const r = await processPayment(
      basePayment({
        amount: 100_000,
        memo: "tien an sang",
        senderAccountNo: "5555",
      }) as never,
      "msg-fallback-fund",
    );
    expect(r.status).toBe("matched_fund");
  });

  // ─── Confirmation persistence ───

  it("does not double-confirm an already-confirmed debt (does not match it)", async () => {
    const m = await seedMember({ bankAccountNo: "5555" });
    const sId = await seedSession();
    await seedDebt(sId, m, 100_000, /*confirmed=*/ true);

    const r = await processPayment(
      basePayment({
        amount: 100_000,
        memo: `S${sId}`,
        senderAccountNo: "5555",
      }) as never,
      "msg-already-confirmed",
    );
    // No unpaid debt → pending (no ledger insert)
    expect(r.status).toBe("pending");

    const txs = await testDb.query.financialTransactions.findMany({
      where: eq(financialTransactions.type, "bank_payment_received"),
    });
    expect(txs).toHaveLength(0);
  });

  it("links matched_debt_id and matched_transaction_id on the notification", async () => {
    const m = await seedMember({ bankAccountNo: "5555" });
    const sId = await seedSession();
    const debtId = await seedDebt(sId, m, 100_000);

    const r = await processPayment(
      basePayment({
        amount: 100_000,
        memo: `S${sId}`,
        senderAccountNo: "5555",
      }) as never,
      "msg-link",
    );
    expect(r.status).toBe("matched_debt");

    const notif = await testDb.query.paymentNotifications.findFirst({
      where: and(eq(paymentNotifications.gmailMessageId, "msg-link")),
    });
    expect(notif?.matchedDebtId).toBe(debtId);
    expect(notif?.matchedTransactionId).toBe(r.transactionId!);
    expect(notif?.status).toBe("matched");
  });
});

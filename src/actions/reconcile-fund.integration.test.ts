/**
 * Integration tests cho `reconcileFund` — invariants kiểm soát chính xác
 * tài chính của hệ thống quỹ gộp:
 *
 *   I1. Σ(in) − Σ(out) − Σ(refund) = Σ(per-member balance)
 *   I3. Mọi paymentNotification.matched có tx tham chiếu
 *   I4. Mọi tx.paymentNotificationId trỏ tới notif tồn tại
 *   I5. Không có tx amount âm hoặc non-integer (DB constraint không bắt; ta check)
 *   I6. Không có idempotencyKey trùng
 *
 * Test bằng cách dựng dữ liệu vi phạm rồi kỳ vọng `reconcileFund` báo issue
 * tương ứng.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  members,
  fundMembers,
  paymentNotifications,
  financialTransactions,
  sessions,
  sessionDebts,
} from "@/db/schema";

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

// Stub admin auth so reconcileFund passes the requireAdmin gate.
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn().mockResolvedValue({
    admin: { sub: "1", username: "admin" },
  }),
}));

const { reconcileFund } = await import("./reconcile-fund");

async function reset() {
  await client.execute("DELETE FROM financial_transactions");
  await client.execute("DELETE FROM payment_notifications");
  await client.execute("DELETE FROM session_debts");
  await client.execute("DELETE FROM sessions");
  await client.execute("DELETE FROM fund_members");
  await client.execute("DELETE FROM members");
}

async function seedMember(name: string, fbId: string) {
  const [m] = await testDb
    .insert(members)
    .values({ name, facebookId: fbId })
    .returning({ id: members.id });
  await testDb.insert(fundMembers).values({
    memberId: m.id,
    isActive: true,
    joinedAt: new Date().toISOString(),
  });
  return m.id;
}

describe("reconcileFund — empty database", () => {
  beforeEach(async () => {
    await reset();
  });

  it("reports ok=true with zero totals when DB is empty", async () => {
    const r = await reconcileFund();
    expect(r.ok).toBe(true);
    expect(r.totals.totalIn).toBe(0);
    expect(r.totals.totalOut).toBe(0);
    expect(r.totals.totalRefund).toBe(0);
    expect(r.totals.netInternal).toBe(0);
    expect(r.totals.netByMembers).toBe(0);
    expect(r.issues).toHaveLength(0);
  });
});

describe("reconcileFund — happy path", () => {
  beforeEach(async () => {
    await reset();
  });

  it("ok=true when in/out/refund all balance and member sums match", async () => {
    const a = await seedMember("Alice", "fb-A");
    const b = await seedMember("Bob", "fb-B");

    // Alice contributes 1M, deducted 200k. Bob contributes 500k.
    await testDb.insert(financialTransactions).values([
      {
        type: "fund_contribution",
        direction: "in",
        amount: 1_000_000,
        memberId: a,
      },
      {
        type: "fund_deduction",
        direction: "out",
        amount: 200_000,
        memberId: a,
      },
      {
        type: "fund_contribution",
        direction: "in",
        amount: 500_000,
        memberId: b,
      },
    ]);

    const r = await reconcileFund();
    expect(r.ok).toBe(true);
    expect(r.totals.totalIn).toBe(1_500_000);
    expect(r.totals.totalOut).toBe(200_000);
    expect(r.totals.totalRefund).toBe(0);
    expect(r.totals.netInternal).toBe(1_300_000);
    expect(r.totals.sumPositiveBalances).toBe(1_300_000);
    expect(r.totals.sumNegativeBalances).toBe(0);
    expect(r.totals.netByMembers).toBe(1_300_000);
  });

  it("ok=true when one member has negative balance (debt)", async () => {
    const a = await seedMember("Alice", "fb-A");
    const b = await seedMember("Bob", "fb-B");

    // Alice contributed 1M then got deducted 1.5M (still owes 500k).
    // Bob contributed 800k.
    await testDb.insert(financialTransactions).values([
      {
        type: "fund_contribution",
        direction: "in",
        amount: 1_000_000,
        memberId: a,
      },
      {
        type: "fund_deduction",
        direction: "out",
        amount: 1_500_000,
        memberId: a,
      },
      {
        type: "fund_contribution",
        direction: "in",
        amount: 800_000,
        memberId: b,
      },
    ]);

    const r = await reconcileFund();
    expect(r.ok).toBe(true);
    expect(r.totals.netInternal).toBe(300_000);
    expect(r.totals.sumPositiveBalances).toBe(800_000);
    expect(r.totals.sumNegativeBalances).toBe(-500_000);
    expect(r.totals.netByMembers).toBe(300_000);
  });
});

describe("reconcileFund — invariant violations", () => {
  beforeEach(async () => {
    await reset();
  });

  it("flags I3: paymentNotifications.matched without linked tx", async () => {
    await seedMember("Alice", "fb-A");
    // Insert a notification marked matched but DON'T insert any tx referencing it.
    await testDb.insert(paymentNotifications).values({
      gmailMessageId: "test-msg-1",
      senderBank: "TIMO",
      amount: 500_000,
      transferContent: "FWBB QUY 1",
      status: "matched",
      rawSnippet: "test",
    });

    const r = await reconcileFund();
    const i3 = r.issues.find((i) => i.code === "I3_matched_without_tx");
    expect(i3).toBeDefined();
    expect(i3?.severity).toBe("warn");
    expect(r.paymentNotifications.matchedWithoutTx).toBe(1);
  });

  it("flags I4: tx.paymentNotificationId pointing at a non-existent row", async () => {
    const a = await seedMember("Alice", "fb-A");
    await testDb.insert(financialTransactions).values({
      type: "fund_contribution",
      direction: "in",
      amount: 100_000,
      memberId: a,
      paymentNotificationId: 9999, // doesn't exist
    });

    const r = await reconcileFund();
    const i4 = r.issues.find((i) => i.code === "I4_missing_notif");
    expect(i4).toBeDefined();
    expect(i4?.severity).toBe("error");
    expect(r.ok).toBe(false);
  });

  it("flags I6: duplicate idempotency_key (only via legacy data — UNIQUE bắt prod)", async () => {
    // Note: in production the UNIQUE INDEX on idempotency_key prevents this
    // from happening. This test simulates corrupt legacy data via raw SQL that
    // somehow bypassed the index (e.g. dump-restore from a pre-migration db).
    // We can't actually insert duplicates because the partial UNIQUE catches
    // them at insert time — so we verify the unique constraint itself.
    const a = await seedMember("Alice", "fb-A");
    await testDb.insert(financialTransactions).values({
      type: "fund_contribution",
      direction: "in",
      amount: 100_000,
      memberId: a,
      idempotencyKey: "dup-key",
    });

    let threw = false;
    try {
      await testDb.insert(financialTransactions).values({
        type: "fund_contribution",
        direction: "in",
        amount: 100_000,
        memberId: a,
        idempotencyKey: "dup-key",
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    // The single row that did land should not trigger I6.
    const r = await reconcileFund();
    const i6 = r.issues.find((i) => i.code === "I6_duplicate_idempotency_key");
    expect(i6).toBeUndefined();
  });

  it("aggregates issues — multiple violations counted in one pass", async () => {
    const a = await seedMember("Alice", "fb-A");

    // I3: matched notif without tx
    await testDb.insert(paymentNotifications).values({
      gmailMessageId: "msg-orphan",
      senderBank: "TIMO",
      amount: 500_000,
      status: "matched",
      rawSnippet: "x",
    });
    // I4: tx pointing to missing notif
    await testDb.insert(financialTransactions).values({
      type: "fund_contribution",
      direction: "in",
      amount: 100_000,
      memberId: a,
      paymentNotificationId: 9999,
    });

    const r = await reconcileFund();
    expect(r.ok).toBe(false);
    expect(r.issues.length).toBeGreaterThanOrEqual(2);
    expect(r.issues.some((i) => i.code === "I3_matched_without_tx")).toBe(true);
    expect(r.issues.some((i) => i.code === "I4_missing_notif")).toBe(true);
  });
});

describe("reconcileFund — edge cases", () => {
  beforeEach(async () => {
    await reset();
  });

  it("counts pending notifications correctly", async () => {
    await testDb.insert(paymentNotifications).values([
      {
        gmailMessageId: "p1",
        senderBank: "TIMO",
        amount: 100_000,
        status: "pending",
        rawSnippet: "x",
      },
      {
        gmailMessageId: "p2",
        senderBank: "TIMO",
        amount: 200_000,
        status: "pending",
        rawSnippet: "x",
      },
    ]);

    const r = await reconcileFund();
    expect(r.paymentNotifications.pending).toBe(2);
    expect(r.paymentNotifications.matched).toBe(0);
  });

  it("ignores debt_created and other neutral types in I1 sum", async () => {
    const a = await seedMember("Alice", "fb-A");
    // debt_created with direction=neutral should NOT count toward in/out.
    await testDb.insert(financialTransactions).values({
      type: "debt_created",
      direction: "neutral",
      amount: 500_000,
      memberId: a,
    });
    await testDb.insert(financialTransactions).values({
      type: "fund_contribution",
      direction: "in",
      amount: 1_000_000,
      memberId: a,
    });

    const r = await reconcileFund();
    expect(r.ok).toBe(true);
    expect(r.totals.totalIn).toBe(1_000_000);
    expect(r.totals.totalOut).toBe(0);
    expect(r.totals.netInternal).toBe(1_000_000);
    expect(r.totals.netByMembers).toBe(1_000_000);
  });
});

describe("reconcileFund — I7/I8/I9 (debt ledger consistency)", () => {
  beforeEach(reset);

  async function seedSessionAndDebt(
    memberId: number,
    opts: { memberConfirmed: boolean; adminConfirmed: boolean },
  ) {
    const [s] = await testDb
      .insert(sessions)
      .values({ date: "2026-04-20", status: "completed", courtPrice: 100_000 })
      .returning({ id: sessions.id });
    const [d] = await testDb
      .insert(sessionDebts)
      .values({
        sessionId: s.id,
        memberId,
        totalAmount: 100_000,
        memberConfirmed: opts.memberConfirmed,
        adminConfirmed: opts.adminConfirmed,
      })
      .returning({ id: sessionDebts.id });
    return { sessionId: s.id, debtId: d.id };
  }

  // I7 is normally impossible to violate at the row level because the schema
  // FK on debtId would reject a stale reference. We still keep the invariant
  // in code as defence-in-depth (FK could be off via raw SQL/migrations).
  // No test here — FK rejects the very setup we'd need.

  it("flags I8: bank_payment_received but debt missing memberConfirmed/adminConfirmed flags", async () => {
    const m = await seedMember("Alice", "fb-A");
    const { debtId } = await seedSessionAndDebt(m, {
      memberConfirmed: false,
      adminConfirmed: false,
    });

    await testDb.insert(financialTransactions).values({
      type: "bank_payment_received",
      direction: "in",
      amount: 100_000,
      memberId: m,
      debtId,
    });

    const r = await reconcileFund();
    expect(r.debtLedger.bankPaidWithoutFlags).toBe(1);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "I8_bank_paid_partial_flags")).toBe(
      true,
    );
  });

  it("ok=true when bank_payment_received properly flips both flags", async () => {
    const m = await seedMember("Alice", "fb-A");
    const { debtId } = await seedSessionAndDebt(m, {
      memberConfirmed: true,
      adminConfirmed: true,
    });

    await testDb.insert(financialTransactions).values({
      type: "bank_payment_received",
      direction: "in",
      amount: 100_000,
      memberId: m,
      debtId,
    });

    const r = await reconcileFund();
    expect(r.debtLedger.bankPaidWithoutFlags).toBe(0);
    expect(r.issues.filter((i) => i.code.startsWith("I8")).length).toBe(0);
  });

  it("flags I9: orphan reversal (reversalOfId points at a missing tx)", async () => {
    const m = await seedMember("Alice", "fb-A");
    await testDb.insert(financialTransactions).values({
      type: "fund_contribution",
      direction: "in",
      amount: 50_000,
      memberId: m,
      reversalOfId: 99_999, // never existed
    });

    const r = await reconcileFund();
    expect(r.debtLedger.orphanReversals).toBe(1);
    expect(r.issues.some((i) => i.code === "I9_orphan_reversal")).toBe(true);
  });

  it("ok=true when reversal properly references a real tx", async () => {
    const m = await seedMember("Alice", "fb-A");
    const [orig] = await testDb
      .insert(financialTransactions)
      .values({
        type: "fund_deduction",
        direction: "out",
        amount: 50_000,
        memberId: m,
      })
      .returning({ id: financialTransactions.id });
    await testDb.insert(financialTransactions).values({
      type: "fund_contribution",
      direction: "in",
      amount: 50_000,
      memberId: m,
      reversalOfId: orig.id,
    });

    const r = await reconcileFund();
    expect(r.debtLedger.orphanReversals).toBe(0);
  });
});

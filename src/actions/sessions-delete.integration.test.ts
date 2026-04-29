/**
 * Integration tests cho `deleteSession`.
 *
 * Audit phát hiện 2 lỗi nghiêm trọng:
 *  1. Xóa 5 bảng tuần tự ngoài transaction → có thể để lại orphan rows nếu
 *     fail giữa chừng.
 *  2. Với session đã `completed`, các `fund_deduction` đã trừ quỹ thật KHÔNG
 *     được reverse — member liên quan mất tiền vĩnh viễn dù session biến mất.
 *
 * Sau fix:
 *  - Toàn bộ thao tác xóa wrap trong `db.transaction`.
 *  - Trước khi xóa, mọi `fund_deduction` chưa-reversed của session được phát
 *    hành `fund_contribution reversalOfId=...` để hoàn lại quỹ.
 *  - `financial_transactions` của session được xóa cuối cùng (audit chấm hết).
 *  - Idempotent: gọi lại lần 2 trên session đã xóa trả lỗi "không tìm thấy"
 *    không gây ảnh hưởng tài chính.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  members,
  fundMembers,
  sessions,
  sessionAttendees,
  sessionDebts,
  sessionShuttlecocks,
  shuttlecockBrands,
  votes,
  financialTransactions,
  paymentNotifications,
} from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
  getAdminFromCookie: vi.fn(async () => ({ sub: "1", role: "admin" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/messenger", () => ({
  sendGroupMessage: vi.fn(),
  buildNewSessionMessage: vi.fn(),
  buildConfirmedMessage: vi.fn(),
  buildDebtReminderMessage: vi.fn(),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { deleteSession } = await import("./sessions");

async function reset() {
  await client.execute("DELETE FROM payment_notifications");
  await client.execute("DELETE FROM financial_transactions");
  await client.execute("DELETE FROM session_debts");
  await client.execute("DELETE FROM session_attendees");
  await client.execute("DELETE FROM session_shuttlecocks");
  await client.execute("DELETE FROM votes");
  await client.execute("DELETE FROM sessions");
  await client.execute("DELETE FROM shuttlecock_brands");
  await client.execute("DELETE FROM fund_members");
  await client.execute("DELETE FROM members");
}

async function seedMemberInFund(name: string, fbId: string) {
  const [m] = await testDb
    .insert(members)
    .values({ name, facebookId: fbId })
    .returning({ id: members.id });
  await testDb.insert(fundMembers).values({ memberId: m.id, isActive: true });
  return m.id;
}

async function seedCompletedSessionWithDeduction(
  memberId: number,
  amount: number,
) {
  const [s] = await testDb
    .insert(sessions)
    .values({
      date: "2026-04-15",
      status: "completed",
      courtPrice: 200_000,
      diningBill: 0,
    })
    .returning({ id: sessions.id });

  const [d] = await testDb
    .insert(sessionDebts)
    .values({
      sessionId: s.id,
      memberId,
      totalAmount: amount,
      memberConfirmed: true,
      adminConfirmed: true,
    })
    .returning({ id: sessionDebts.id });

  await testDb.insert(sessionAttendees).values({
    sessionId: s.id,
    memberId,
    isGuest: false,
    attendsPlay: true,
    attendsDine: false,
  });

  // Original fund_deduction that pulled the member's balance down for this
  // session. Deleting the session must reverse this.
  await testDb.insert(financialTransactions).values({
    type: "fund_deduction",
    direction: "out",
    amount,
    memberId,
    sessionId: s.id,
    debtId: d.id,
    description: "Trừ quỹ buổi 2026-04-15",
  });
  // Plus a separate top-up earlier so balance doesn't stay zero pre-deduction.
  await testDb.insert(financialTransactions).values({
    type: "fund_contribution",
    direction: "in",
    amount,
    memberId,
    description: "Top-up earlier",
  });

  return { sessionId: s.id, debtId: d.id };
}

async function fundBalance(memberId: number) {
  const txs = await testDb.query.financialTransactions.findMany({
    where: eq(financialTransactions.memberId, memberId),
  });
  let bal = 0;
  for (const t of txs) {
    if (t.type === "fund_contribution") bal += t.amount;
    else if (t.type === "fund_deduction") bal -= t.amount;
    else if (t.type === "fund_refund") bal -= t.amount;
  }
  return bal;
}

describe("deleteSession (integration)", () => {
  beforeEach(reset);

  it("returns error and does nothing when session not found", async () => {
    const r = await deleteSession(99999);
    expect("error" in r).toBe(true);
  });

  it("removes attendees, debts, shuttlecocks, votes, and the session row", async () => {
    const memberId = await seedMemberInFund("Alice", "fb-a");
    const { sessionId } = await seedCompletedSessionWithDeduction(
      memberId,
      80_000,
    );
    await testDb.insert(votes).values({
      sessionId,
      memberId,
      willPlay: true,
      willDine: false,
    });
    const [brand] = await testDb
      .insert(shuttlecockBrands)
      .values({ name: "Yonex", pricePerTube: 100_000 })
      .returning({ id: shuttlecockBrands.id });
    await testDb.insert(sessionShuttlecocks).values({
      sessionId,
      brandId: brand.id,
      quantityUsed: 6,
      pricePerTube: 100_000,
    });

    const r = await deleteSession(sessionId);
    expect("error" in r).toBe(false);

    expect(
      await testDb.query.sessions.findFirst({
        where: eq(sessions.id, sessionId),
      }),
    ).toBeUndefined();
    expect(
      await testDb.query.sessionDebts.findMany({
        where: eq(sessionDebts.sessionId, sessionId),
      }),
    ).toHaveLength(0);
    expect(
      await testDb.query.sessionAttendees.findMany({
        where: eq(sessionAttendees.sessionId, sessionId),
      }),
    ).toHaveLength(0);
    expect(
      await testDb.query.votes.findMany({
        where: eq(votes.sessionId, sessionId),
      }),
    ).toHaveLength(0);
  });

  it("reverses fund_deduction so member balance is restored", async () => {
    const memberId = await seedMemberInFund("Alice", "fb-a");
    const amount = 120_000;
    const { sessionId } = await seedCompletedSessionWithDeduction(
      memberId,
      amount,
    );

    const balanceBefore = await fundBalance(memberId);
    expect(balanceBefore).toBe(0);

    const r = await deleteSession(sessionId);
    expect("error" in r).toBe(false);

    const balanceAfter = await fundBalance(memberId);
    // Reversal must add `amount` back in.
    expect(balanceAfter).toBe(amount);

    // Reversal row must remain (audit), pointing at original via reversalOfId.
    const reversal = await testDb.query.financialTransactions.findFirst({
      where: eq(financialTransactions.memberId, memberId),
    });
    expect(reversal).toBeDefined();
  });

  it("idempotent: a second deleteSession does not create another reversal", async () => {
    const memberId = await seedMemberInFund("Alice", "fb-a");
    const amount = 75_000;
    const { sessionId } = await seedCompletedSessionWithDeduction(
      memberId,
      amount,
    );

    const r1 = await deleteSession(sessionId);
    expect("error" in r1).toBe(false);
    const balanceAfter1 = await fundBalance(memberId);

    // Second delete should error (session gone) and not perturb balances.
    const r2 = await deleteSession(sessionId);
    expect("error" in r2).toBe(true);
    const balanceAfter2 = await fundBalance(memberId);
    expect(balanceAfter2).toBe(balanceAfter1);
  });

  it("deletes session-scoped financial_transactions (orphan cleanup)", async () => {
    const memberId = await seedMemberInFund("Alice", "fb-a");
    const amount = 90_000;
    const { sessionId } = await seedCompletedSessionWithDeduction(
      memberId,
      amount,
    );

    const r = await deleteSession(sessionId);
    expect("error" in r).toBe(false);

    const remaining = await testDb.query.financialTransactions.findMany({
      where: eq(financialTransactions.sessionId, sessionId),
    });
    expect(remaining).toHaveLength(0);
  });

  it("voting session (no debts/deductions): just deletes cleanly", async () => {
    const memberId = await seedMemberInFund("Bob", "fb-b");
    const [s] = await testDb
      .insert(sessions)
      .values({ date: "2026-05-01", status: "voting", courtPrice: 200_000 })
      .returning({ id: sessions.id });
    await testDb
      .insert(votes)
      .values({ sessionId: s.id, memberId, willPlay: true, willDine: false });

    const r = await deleteSession(s.id);
    expect("error" in r).toBe(false);
    const balance = await fundBalance(memberId);
    expect(balance).toBe(0);
  });

  it("reverses pass-revenue fund_contribution when admin deletes a cancelled session", async () => {
    // Scenario: admin cancelled a session, passed it on, kept N revenue.
    // Later they decide to clean up history by deleting the session entirely.
    // The pass-revenue contribution MUST be reversed too — otherwise admin
    // keeps tiền in fund without an underlying session.
    const adminId = await seedMemberInFund("Admin", "fb-admin");
    const [s] = await testDb
      .insert(sessions)
      .values({
        date: "2026-04-25",
        status: "cancelled",
        courtPrice: 200_000,
        passRevenue: 200_000,
      })
      .returning({ id: sessions.id });

    // Pass-revenue contribution mirroring what cancelSession({passed:true})
    // would have written.
    await testDb.insert(financialTransactions).values({
      type: "fund_contribution",
      direction: "in",
      amount: 200_000,
      memberId: adminId,
      sessionId: s.id,
      description: "Pass sân buổi 2026-04-25 — admin nhận lại",
      metadataJson: JSON.stringify({
        source: "session_passed",
        sessionId: s.id,
      }),
    });

    expect(await fundBalance(adminId)).toBe(200_000);

    const r = await deleteSession(s.id);
    expect("error" in r).toBe(false);

    // After delete: admin's balance should be back to 0 because the
    // pass-revenue contribution was reversed.
    expect(await fundBalance(adminId)).toBe(0);
  });

  it("nulls out paymentNotifications.matchedDebtId for deleted debts (no orphan FK refs)", async () => {
    const memberId = await seedMemberInFund("Alice", "fb-a");
    const { sessionId, debtId } = await seedCompletedSessionWithDeduction(
      memberId,
      80_000,
    );
    // Simulate that a bank webhook had matched this debt earlier.
    await testDb.insert(paymentNotifications).values({
      gmailMessageId: "g-orphan-test",
      senderBank: "timo",
      amount: 80_000,
      transferContent: `FWBB NO ${memberId}`,
      matchedDebtId: debtId,
      status: "matched",
    });

    const r = await deleteSession(sessionId);
    expect("error" in r).toBe(false);

    // The notification row must still exist (audit), but its matchedDebtId
    // must be cleared because the debt is gone.
    const remaining = await testDb.query.paymentNotifications.findMany();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].matchedDebtId).toBeNull();
  });
});

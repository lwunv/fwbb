/**
 * Integration tests for `finalizeSession` min-deduction penalty surplus flow.
 *
 * When `session.useMinDeduction = true` and the floor fires on a member,
 * `applyMinDeductionFloor` overrides their totalAmount (e.g. 30K → 60K).
 * The surplus penalty (floored - original_share) must flow into the admin's
 * fund_contribution so invariant I1 (Σ fund_deduction ≈ admin's real cash
 * out) holds.
 *
 * Spec: docs/superpowers/specs/2026-05-15-min-deduction-floor-design.md:29
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  members,
  sessions,
  sessionDebts,
  financialTransactions,
  admins as adminsTable,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { computeBalanceFromTransactions } from "@/lib/fund-core";

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
  getAdminFromCookie: vi.fn(async () => ({ sub: "1", role: "admin" })),
}));
import { requireAdmin } from "@/lib/auth";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/messenger", () => ({
  sendGroupMessage: vi.fn(),
  buildDebtReminderMessage: vi.fn(() => ""),
  buildNewSessionMessage: vi.fn(),
  buildConfirmedMessage: vi.fn(),
}));
vi.mock("@/lib/user-identity", () => ({
  getUserFromCookie: vi.fn(async () => null),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { finalizeSession } = await import("./finance");

async function reset() {
  await client.execute("DELETE FROM payment_notifications");
  await client.execute("DELETE FROM financial_transactions");
  await client.execute("DELETE FROM session_min_deduction_exemptions");
  await client.execute("DELETE FROM session_debts");
  await client.execute("DELETE FROM session_attendees");
  await client.execute("DELETE FROM session_shuttlecocks");
  await client.execute("DELETE FROM votes");
  await client.execute("DELETE FROM sessions");
  await client.execute("DELETE FROM admins");
  await client.execute("DELETE FROM members");
}

/**
 * Seed: 1 admin member + 3 regular members. Returns their ids.
 * Updates the requireAdmin mock to align JWT.sub with actual admin row id.
 */
async function seedActors() {
  const inserted = await testDb
    .insert(members)
    .values([
      { name: "Admin", facebookId: "fb-admin" },
      { name: "Alice", facebookId: "fb-alice" },
      { name: "Bob", facebookId: "fb-bob" },
      { name: "Carol", facebookId: "fb-carol" },
    ])
    .returning({ id: members.id });
  const [adminMember, alice, bob, carol] = inserted;

  const [adminRow] = await testDb
    .insert(adminsTable)
    .values({ username: "Admin", passwordHash: "x", memberId: adminMember.id })
    .returning({ id: adminsTable.id });

  // Align JWT.sub with actual admin row id (SQLite auto-increment may not be 1).
  vi.mocked(requireAdmin).mockResolvedValue({
    admin: { sub: String(adminRow.id), role: "admin" },
  } as never);

  return {
    adminMemberId: adminMember.id,
    aliceId: alice.id,
    bobId: bob.id,
    carolId: carol.id,
  };
}

async function contributeToFund(memberId: number, amount: number) {
  await testDb.insert(financialTransactions).values({
    type: "fund_contribution",
    direction: "in",
    amount,
    memberId,
  });
}

async function seedSessionWithMinDeduction(courtPrice: number) {
  // Use a unique date to avoid UNIQUE constraint conflict when reset() is used.
  const date = `2026-05-${String(Math.floor(Math.random() * 27) + 1).padStart(2, "0")}`;
  const [s] = await testDb
    .insert(sessions)
    .values({ date, status: "confirmed", courtPrice, useMinDeduction: true })
    .returning({ id: sessions.id });
  return s.id;
}

describe("finalizeSession — min-deduction penalty surplus → admin fund", () => {
  beforeEach(reset);

  it("credits admin with surplus when floor fires on a member with zero balance", async () => {
    // Setup:
    //   courtPrice = 90K, 4 players (admin, Alice, Bob, Carol), no shuttle, no dining.
    //   per-head share = roundToThousand(90K / 4) = roundToThousand(22.5K) = 23K.
    //   Alice: balance = 0, playAmount = 23K < 60K floor → floor fires → deduction = 60K.
    //     penalty = 60K - 23K = 37K credited to admin.
    //   Bob, Carol: balance = 200K ≥ 23K playAmount → floor does NOT fire (no-op).
    //   Admin: fundDeductionAmount = 0, no penalty (isAdminDebt).
    const { adminMemberId, aliceId, bobId, carolId } = await seedActors();

    // Only Bob and Carol have fund balance; Alice has 0.
    // (All members are in-fund by default: isActive=true, approvalStatus='approved'.)
    await contributeToFund(bobId, 200_000);
    await contributeToFund(carolId, 200_000);

    const sessionId = await seedSessionWithMinDeduction(90_000);

    const attendeeList = [
      // Admin member (no deduction)
      {
        memberId: adminMemberId,
        guestName: null,
        invitedById: null,
        isGuest: false,
        attendsPlay: true,
        attendsDine: false,
      },
      // Alice — balance 0, playAmount 23K < 60K floor → fires
      {
        memberId: aliceId,
        guestName: null,
        invitedById: null,
        isGuest: false,
        attendsPlay: true,
        attendsDine: false,
      },
      // Bob — balance 200K ≥ playAmount → no-op
      {
        memberId: bobId,
        guestName: null,
        invitedById: null,
        isGuest: false,
        attendsPlay: true,
        attendsDine: false,
      },
      // Carol — balance 200K ≥ playAmount → no-op
      {
        memberId: carolId,
        guestName: null,
        invitedById: null,
        isGuest: false,
        attendsPlay: true,
        attendsDine: false,
      },
    ];

    const result = await finalizeSession(sessionId, attendeeList, 0);
    expect("error" in result).toBe(false);

    // per-head = roundToThousand(90_000 / 4) = 23_000
    const perHead = 23_000;
    const flooredAmount = 60_000;
    const expectedPenalty = flooredAmount - perHead; // 37_000

    // --- sessionDebts assertions ---
    const debts = await testDb.query.sessionDebts.findMany({
      where: eq(sessionDebts.sessionId, sessionId),
    });
    const debtByMember = new Map(debts.map((d) => [d.memberId, d]));

    // Alice: floored to 60K
    expect(debtByMember.get(aliceId)?.totalAmount).toBe(flooredAmount);
    // Bob and Carol: original 23K each
    expect(debtByMember.get(bobId)?.totalAmount).toBe(perHead);
    expect(debtByMember.get(carolId)?.totalAmount).toBe(perHead);

    // --- fund_deduction rows ---
    const deductions = await testDb.query.financialTransactions.findMany({
      where: and(
        eq(financialTransactions.sessionId, sessionId),
        eq(financialTransactions.type, "fund_deduction"),
      ),
    });
    const dedByMember = new Map(deductions.map((d) => [d.memberId, d]));

    // Alice deducted full floored amount
    expect(dedByMember.get(aliceId)?.amount).toBe(flooredAmount);
    // Bob and Carol deducted original share
    expect(dedByMember.get(bobId)?.amount).toBe(perHead);
    expect(dedByMember.get(carolId)?.amount).toBe(perHead);
    // Admin: charged own play (new design)
    expect(dedByMember.get(adminMemberId)?.amount).toBe(perHead);

    // --- penalty fund_contribution for admin ---
    const penaltyContribs = await testDb.query.financialTransactions.findMany({
      where: and(
        eq(financialTransactions.sessionId, sessionId),
        eq(financialTransactions.type, "fund_contribution"),
        eq(financialTransactions.memberId, adminMemberId),
      ),
    });
    // Exactly 1 penalty row (only Alice fired the floor)
    expect(penaltyContribs).toHaveLength(1);
    expect(penaltyContribs[0].amount).toBe(expectedPenalty);
    expect(penaltyContribs[0].idempotencyKey).toMatch(
      /^min-deduction-penalty-/,
    );

    // --- sum check: Σ fund_deduction − Σ admin penalty contribution = total court cost rounded up ---
    // Admin now charged like normal: 4 deductions (60K + 23K + 23K + 23K = 129K).
    // Penalty: 37K. Net: 129K − 37K = 92K = 4 × perHead (= courtPrice 90K + 2K round-up bonus).
    const totalDeducted = deductions.reduce((s, d) => s + d.amount, 0);
    const totalPenalty = penaltyContribs.reduce((s, d) => s + d.amount, 0);
    expect(totalDeducted - totalPenalty).toBe(4 * perHead);

    // --- admin balance check: penalty credited − own play deducted ---
    const adminTxs = await testDb.query.financialTransactions.findMany({
      where: eq(financialTransactions.memberId, adminMemberId),
    });
    const adminBalance = computeBalanceFromTransactions(
      adminMemberId,
      adminTxs,
    ).balance;
    expect(adminBalance).toBe(expectedPenalty - perHead);

    // --- Alice balance after finalize: deducted full floored amount ---
    const aliceTxs = await testDb.query.financialTransactions.findMany({
      where: eq(financialTransactions.memberId, aliceId),
    });
    const aliceBalance = computeBalanceFromTransactions(
      aliceId,
      aliceTxs,
    ).balance;
    expect(aliceBalance).toBe(-flooredAmount);
  });

  it("does NOT insert penalty contribution when floor does NOT fire (balance sufficient)", async () => {
    // All members have plenty of balance → floor never fires → no penalty.
    const { adminMemberId, aliceId, bobId } = await seedActors();

    await contributeToFund(aliceId, 300_000);
    await contributeToFund(bobId, 300_000);

    const sessionId = await seedSessionWithMinDeduction(120_000);

    const result = await finalizeSession(
      sessionId,
      [
        {
          memberId: adminMemberId,
          guestName: null,
          invitedById: null,
          isGuest: false,
          attendsPlay: true,
          attendsDine: false,
        },
        {
          memberId: aliceId,
          guestName: null,
          invitedById: null,
          isGuest: false,
          attendsPlay: true,
          attendsDine: false,
        },
        {
          memberId: bobId,
          guestName: null,
          invitedById: null,
          isGuest: false,
          attendsPlay: true,
          attendsDine: false,
        },
      ],
      0,
    );

    expect("error" in result).toBe(false);

    const penaltyContribs = await testDb.query.financialTransactions.findMany({
      where: and(
        eq(financialTransactions.sessionId, sessionId),
        eq(financialTransactions.type, "fund_contribution"),
        eq(financialTransactions.memberId, adminMemberId),
      ),
    });
    expect(penaltyContribs).toHaveLength(0);
  });

  it("does NOT insert penalty contribution when useMinDeduction is false (toggle off)", async () => {
    const { adminMemberId, aliceId } = await seedActors();
    // Alice has 0 balance — would fire floor IF toggle were on.

    const [s] = await testDb
      .insert(sessions)
      .values({
        date: "2026-06-01",
        status: "confirmed",
        courtPrice: 60_000,
        useMinDeduction: false, // toggle off
      })
      .returning({ id: sessions.id });

    const result = await finalizeSession(
      s.id,
      [
        {
          memberId: adminMemberId,
          guestName: null,
          invitedById: null,
          isGuest: false,
          attendsPlay: true,
          attendsDine: false,
        },
        {
          memberId: aliceId,
          guestName: null,
          invitedById: null,
          isGuest: false,
          attendsPlay: true,
          attendsDine: false,
        },
      ],
      0,
    );

    expect("error" in result).toBe(false);

    const penaltyContribs = await testDb.query.financialTransactions.findMany({
      where: and(
        eq(financialTransactions.sessionId, s.id),
        eq(financialTransactions.type, "fund_contribution"),
        eq(financialTransactions.memberId, adminMemberId),
      ),
    });
    expect(penaltyContribs).toHaveLength(0);
  });

  it("penalty is idempotent on re-finalize (reverse + reinsert)", async () => {
    // First finalize fires floor → penalty inserted.
    // Re-finalize same session same attendees → old deduction reversed,
    // new deduction inserted; penalty from re-finalize is the same amount.
    // DB idempotencyKey includes insertedDebt.id (new on re-finalize) so no
    // UNIQUE collision — two separate penalty rows across the two finalizations.
    // This test verifies re-finalize succeeds and net admin balance stays correct.
    const { adminMemberId, aliceId } = await seedActors();

    const sessionId = await seedSessionWithMinDeduction(60_000);

    const attendeeList = [
      {
        memberId: adminMemberId,
        guestName: null,
        invitedById: null,
        isGuest: false,
        attendsPlay: true,
        attendsDine: false,
      },
      {
        memberId: aliceId,
        guestName: null,
        invitedById: null,
        isGuest: false,
        attendsPlay: true,
        attendsDine: false,
      },
    ];

    // First finalize: courtPrice 60K, 2 players → 30K per head.
    // Alice: balance 0, playAmount 30K < floor → deduction 60K, penalty 30K.
    const r1 = await finalizeSession(sessionId, attendeeList, 0);
    expect("error" in r1).toBe(false);

    // Re-finalize same payload.
    const r2 = await finalizeSession(sessionId, attendeeList, 0);
    expect("error" in r2).toBe(false);

    // Re-finalize PHẢI idempotent về tiền. Admin chơi (own deduction 30K) +
    // nhận penalty surplus 30K từ Alice (bị floor) → net balance admin = 0 sau
    // MỖI lần finalize. Bug cũ: penalty fund_contribution của admin KHÔNG bị
    // reverse khi re-finalize (reverse step chỉ đụng fund_deduction) → admin
    // double-credit (+30K). Fix: reverse penalty cũ → balance admin giữ 0.
    const adminTxs = await testDb.query.financialTransactions.findMany({
      where: eq(financialTransactions.memberId, adminMemberId),
    });
    const adminBalance = computeBalanceFromTransactions(
      adminMemberId,
      adminTxs,
    ).balance;
    expect(adminBalance).toBe(0);

    const debts = await testDb.query.sessionDebts.findMany({
      where: eq(sessionDebts.sessionId, sessionId),
    });
    const aliceDebt = debts.find((d) => d.memberId === aliceId);
    expect(aliceDebt?.totalAmount).toBe(60_000);
  });
});

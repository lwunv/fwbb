/**
 * F1 — undo → re-confirm cycle integration tests.
 *
 * Bug: `undoPaymentByAdmin` reverses the `fund_deduction` row (and any admin
 * min-deduction penalty contribution) by inserting paired reversals. Later
 * `confirmPaymentByAdmin`/`confirmPaymentByMember` only flipped the
 * `adminConfirmed`/`memberConfirmed` flags and wrote a `debt_admin_confirmed`
 * audit row — NO fresh `fund_deduction` → member balance was permanently
 * credited back, effectively a free session.
 *
 * Fix: re-confirm now detects voided deductions for the debt and re-inserts
 * a matching fund_deduction (and re-inserts admin penalty if it was voided).
 *
 * Scenarios covered:
 *   1. Plain undo → confirm cycle re-inserts deduction.
 *   2. Admin min-deduction penalty is also restored on re-confirm.
 *   3. Multi-cycle undo↔confirm stays balance-correct.
 *   4. Re-confirm with NO prior undo is a no-op (no duplicate deduction).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  members,
  sessions,
  sessionDebts,
  financialTransactions,
  fundMembers,
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

const userMock = vi.hoisted(() => ({
  getUserFromCookie:
    vi.fn<() => Promise<{ memberId: number; facebookId: string } | null>>(),
}));
vi.mock("@/lib/user-identity", () => userMock);

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const {
  finalizeSession,
  confirmPaymentByAdmin,
  confirmPaymentByMember,
  undoPaymentByAdmin,
} = await import("./finance");

async function reset() {
  await client.execute("DELETE FROM payment_notifications");
  await client.execute("DELETE FROM financial_transactions");
  await client.execute("DELETE FROM session_min_deduction_exemptions");
  await client.execute("DELETE FROM session_debts");
  await client.execute("DELETE FROM session_attendees");
  await client.execute("DELETE FROM session_shuttlecocks");
  await client.execute("DELETE FROM votes");
  await client.execute("DELETE FROM fund_members");
  await client.execute("DELETE FROM sessions");
  await client.execute("DELETE FROM admins");
  await client.execute("DELETE FROM members");
  userMock.getUserFromCookie.mockReset();
}

async function seedActors() {
  const inserted = await testDb
    .insert(members)
    .values([
      { name: "Admin", facebookId: "fb-admin" },
      { name: "Alice", facebookId: "fb-alice" },
      { name: "Bob", facebookId: "fb-bob" },
    ])
    .returning({ id: members.id });
  const [adminMember, alice, bob] = inserted;

  const [adminRow] = await testDb
    .insert(adminsTable)
    .values({ username: "Admin", passwordHash: "x", memberId: adminMember.id })
    .returning({ id: adminsTable.id });

  vi.mocked(requireAdmin).mockResolvedValue({
    admin: { sub: String(adminRow.id), role: "admin" },
  } as never);

  return { adminMemberId: adminMember.id, aliceId: alice.id, bobId: bob.id };
}

async function contributeToFund(memberId: number, amount: number) {
  await testDb.insert(financialTransactions).values({
    type: "fund_contribution",
    direction: "in",
    amount,
    memberId,
  });
}

async function joinFund(memberId: number) {
  await testDb
    .insert(fundMembers)
    .values({ memberId, isActive: true })
    .onConflictDoNothing();
}

async function getBalance(memberId: number): Promise<number> {
  const txs = await testDb.query.financialTransactions.findMany({
    where: eq(financialTransactions.memberId, memberId),
  });
  return computeBalanceFromTransactions(memberId, txs).balance;
}

async function seedFinalizedSession(opts: {
  courtPrice: number;
  adminMemberId: number;
  memberIds: number[];
  useMinDeduction?: boolean;
  date?: string;
}): Promise<number> {
  const date =
    opts.date ??
    `2026-05-${String(Math.floor(Math.random() * 27) + 1).padStart(2, "0")}`;
  const [s] = await testDb
    .insert(sessions)
    .values({
      date,
      status: "confirmed",
      courtPrice: opts.courtPrice,
      useMinDeduction: opts.useMinDeduction ?? false,
    })
    .returning({ id: sessions.id });

  const attendeeList = [
    {
      memberId: opts.adminMemberId,
      guestName: null,
      invitedById: null,
      isGuest: false,
      attendsPlay: true,
      attendsDine: false,
    },
    ...opts.memberIds.map((mid) => ({
      memberId: mid,
      guestName: null,
      invitedById: null,
      isGuest: false,
      attendsPlay: true,
      attendsDine: false,
    })),
  ];

  const r = await finalizeSession(s.id, attendeeList, 0);
  expect("error" in r).toBe(false);
  return s.id;
}

async function getDebtId(sessionId: number, memberId: number): Promise<number> {
  const debt = await testDb.query.sessionDebts.findFirst({
    where: and(
      eq(sessionDebts.sessionId, sessionId),
      eq(sessionDebts.memberId, memberId),
    ),
  });
  if (!debt) throw new Error(`debt not found for member ${memberId}`);
  return debt.id;
}

async function countLiveDeductions(debtId: number): Promise<number> {
  // Live fund_deduction = type=fund_deduction, reversalOfId IS NULL, AND
  // no OTHER row (of any type, scoped to this debt) has reversalOfId pointing
  // at it. The reversal of a fund_deduction is a fund_contribution, so we
  // must look across all types when collecting voided ids.
  const allRows = await testDb.query.financialTransactions.findMany({
    where: eq(financialTransactions.debtId, debtId),
  });
  const voidedIds = new Set(
    allRows
      .map((r) => r.reversalOfId)
      .filter((id): id is number => id !== null),
  );
  return allRows.filter(
    (r) =>
      r.type === "fund_deduction" &&
      r.reversalOfId === null &&
      !voidedIds.has(r.id),
  ).length;
}

describe("F1 — undo → re-confirm cycle (confirmPaymentByAdmin)", () => {
  beforeEach(reset);

  it("re-inserts fund_deduction so member is charged again", async () => {
    // Setup: court 60K, admin + Alice + Bob → 20K each. Alice + Bob seeded 100K.
    const { adminMemberId, aliceId, bobId } = await seedActors();
    await joinFund(aliceId);
    await joinFund(bobId);
    await contributeToFund(aliceId, 100_000);
    await contributeToFund(bobId, 100_000);

    const sessionId = await seedFinalizedSession({
      courtPrice: 60_000,
      adminMemberId,
      memberIds: [aliceId, bobId],
    });
    const aliceDebtId = await getDebtId(sessionId, aliceId);

    // After finalize: per-head = 20K → Alice deducted 20K → balance 80K.
    expect(await getBalance(aliceId)).toBe(80_000);

    // Undo: Alice balance returns to 100K, both flags=false.
    const undoR = await undoPaymentByAdmin(aliceDebtId);
    expect("error" in undoR).toBe(false);
    expect(await getBalance(aliceId)).toBe(100_000);
    expect(await countLiveDeductions(aliceDebtId)).toBe(0);

    // Re-confirm: balance MUST be 80K again (re-deducted), not stuck at 100K.
    const confirmR = await confirmPaymentByAdmin(aliceDebtId);
    expect("error" in confirmR).toBe(false);
    expect(await getBalance(aliceId)).toBe(80_000);
    // Exactly 1 live fund_deduction for Alice after re-confirm.
    expect(await countLiveDeductions(aliceDebtId)).toBe(1);

    // Bob untouched.
    expect(await getBalance(bobId)).toBe(80_000);
  });

  it("re-inserts admin min-deduction penalty when re-confirming after undo", async () => {
    // courtPrice 60K, 2 players (admin + Alice). Alice balance 0 →
    // per-head 30K < 60K floor → deduction 60K, penalty 30K credited to admin.
    const { adminMemberId, aliceId } = await seedActors();

    const [s] = await testDb
      .insert(sessions)
      .values({
        date: "2026-06-15",
        status: "confirmed",
        courtPrice: 60_000,
        useMinDeduction: true,
      })
      .returning({ id: sessions.id });

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
    const r1 = await finalizeSession(s.id, attendeeList, 0);
    expect("error" in r1).toBe(false);

    const aliceDebtId = await getDebtId(s.id, aliceId);

    // After finalize: Alice = -60K, Admin = +30K (penalty) − 30K (own play) = 0.
    expect(await getBalance(aliceId)).toBe(-60_000);
    expect(await getBalance(adminMemberId)).toBe(0);

    // Undo: Alice → 0 (her deduction reversed), penalty contribution reversed.
    // Admin's own play deduction stays → admin = -30K.
    const undoR = await undoPaymentByAdmin(aliceDebtId);
    expect("error" in undoR).toBe(false);
    expect(await getBalance(aliceId)).toBe(0);
    expect(await getBalance(adminMemberId)).toBe(-30_000);

    // Re-confirm: penalty re-inserted (+30K). Admin back to 0.
    const confirmR = await confirmPaymentByAdmin(aliceDebtId);
    expect("error" in confirmR).toBe(false);
    expect(await getBalance(aliceId)).toBe(-60_000);
    expect(await getBalance(adminMemberId)).toBe(0);
  });

  it("multi-cycle undo↔confirm stays balance-correct", async () => {
    const { adminMemberId, aliceId } = await seedActors();
    await joinFund(aliceId);
    await contributeToFund(aliceId, 100_000);

    const sessionId = await seedFinalizedSession({
      courtPrice: 40_000,
      adminMemberId,
      memberIds: [aliceId],
    });
    const aliceDebtId = await getDebtId(sessionId, aliceId);

    // per-head = roundToThousand(40000/2) = 20K → Alice 80K.
    expect(await getBalance(aliceId)).toBe(80_000);

    for (let i = 0; i < 3; i++) {
      const u = await undoPaymentByAdmin(aliceDebtId);
      expect("error" in u).toBe(false);
      expect(await getBalance(aliceId)).toBe(100_000);

      const c = await confirmPaymentByAdmin(aliceDebtId);
      expect("error" in c).toBe(false);
      expect(await getBalance(aliceId)).toBe(80_000);
    }

    // After 3 full cycles, still exactly 1 live deduction.
    expect(await countLiveDeductions(aliceDebtId)).toBe(1);
  });

  it("re-confirm WITHOUT prior undo is no-op (no duplicate deduction)", async () => {
    const { adminMemberId, aliceId } = await seedActors();
    await joinFund(aliceId);
    await contributeToFund(aliceId, 100_000);

    const sessionId = await seedFinalizedSession({
      courtPrice: 40_000,
      adminMemberId,
      memberIds: [aliceId],
    });
    const aliceDebtId = await getDebtId(sessionId, aliceId);

    // finalize already sets adminConfirmed=true, so this is a no-op.
    const r = await confirmPaymentByAdmin(aliceDebtId);
    expect("error" in r).toBe(false);

    // Still exactly 1 live deduction (the one from finalize).
    expect(await countLiveDeductions(aliceDebtId)).toBe(1);
    expect(await getBalance(aliceId)).toBe(80_000);
  });
});

describe("F1 — undo → re-confirm cycle (confirmPaymentByMember)", () => {
  beforeEach(reset);

  it("member re-confirm after admin undo re-inserts fund_deduction", async () => {
    const { adminMemberId, aliceId } = await seedActors();
    await joinFund(aliceId);
    await contributeToFund(aliceId, 100_000);

    const sessionId = await seedFinalizedSession({
      courtPrice: 40_000,
      adminMemberId,
      memberIds: [aliceId],
    });
    const aliceDebtId = await getDebtId(sessionId, aliceId);

    // Admin undoes.
    const undoR = await undoPaymentByAdmin(aliceDebtId);
    expect("error" in undoR).toBe(false);
    expect(await getBalance(aliceId)).toBe(100_000);

    // Alice re-confirms via member action.
    userMock.getUserFromCookie.mockResolvedValue({
      memberId: aliceId,
      facebookId: "fb-alice",
    });
    const confirmR = await confirmPaymentByMember(aliceDebtId);
    expect("error" in confirmR).toBe(false);

    // Balance must be re-deducted.
    expect(await getBalance(aliceId)).toBe(80_000);
    expect(await countLiveDeductions(aliceDebtId)).toBe(1);
  });
});

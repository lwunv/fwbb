/**
 * Integration tests for finalizeSession edge cases (HIGH gap per audit).
 *
 * Covers boundary scenarios that real sessions can hit:
 *  - 0 dining bill (admin chốt không có nhậu) → no dineAmount on any debt
 *  - admin with 0 debt: admin's debt row still created, fund_deduction=0
 *  - re-finalize after attendee removal: orphan ledger debtId NULL'd
 *  - all-admin session (only admin attended): admin's debt = 0, no other rows
 *  - dining-only session (court=0): only dineAmount on debts
 *
 * These complement finalize-guests + finalize-min-deduction + finalize-auto
 * which cover the happy + invariant paths.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  sessions,
  admins,
  members,
  sessionAttendees,
  sessionDebts,
  financialTransactions,
} from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
}));
vi.mock("@/lib/messenger", () => ({
  sendGroupMessage: vi.fn(),
  buildDebtReminderMessage: vi.fn(() => ""),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { finalizeSession } = await import("./finance");
import { requireAdmin } from "@/lib/auth";

async function reset() {
  await client.execute("DELETE FROM financial_transactions");
  await client.execute("DELETE FROM session_debts");
  await client.execute("DELETE FROM session_attendees");
  await client.execute("DELETE FROM fund_members");
  await client.execute("DELETE FROM votes");
  await client.execute("DELETE FROM sessions");
  await client.execute("DELETE FROM admins");
  await client.execute("DELETE FROM members");
}

async function seedMember(name: string, fid = `fb-${name}-${Date.now()}`) {
  const [m] = await testDb
    .insert(members)
    .values({ name, facebookId: fid })
    .returning({ id: members.id });
  return m.id;
}

async function seedAdminWithMember(name = "Admin") {
  const memberId = await seedMember(name);
  const [a] = await testDb
    .insert(admins)
    .values({
      username: `a${Date.now()}`,
      passwordHash: "hash",
      memberId,
    })
    .returning({ id: admins.id });
  vi.mocked(requireAdmin).mockResolvedValue({
    admin: { sub: String(a.id), role: "admin" },
  } as never);
  return { adminId: a.id, adminMemberId: memberId };
}

async function seedSession(
  opts: {
    courtPrice?: number;
    diningBill?: number;
  } = {},
) {
  const [s] = await testDb
    .insert(sessions)
    .values({
      date: "2026-04-10",
      status: "confirmed",
      courtPrice: opts.courtPrice ?? 200_000,
      diningBill: opts.diningBill ?? 0,
    })
    .returning({ id: sessions.id });
  return s.id;
}

describe("finalizeSession edge cases (integration)", () => {
  beforeEach(async () => await reset());

  it("0 dining bill — debts have dineAmount=0, no surprise dine charge", async () => {
    const { adminMemberId } = await seedAdminWithMember();
    const p1 = await seedMember("P1");
    const sId = await seedSession({ courtPrice: 200_000, diningBill: 0 });

    const r = await finalizeSession(
      sId,
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
          memberId: p1,
          guestName: null,
          invitedById: null,
          isGuest: false,
          attendsPlay: true,
          attendsDine: false,
        },
      ],
      0,
    );
    expect("error" in r).toBe(false);

    const debts = await testDb.query.sessionDebts.findMany({
      where: eq(sessionDebts.sessionId, sId),
    });
    expect(debts).toHaveLength(2);
    expect(debts.every((d) => d.dineAmount === 0)).toBe(true);
    expect(debts.every((d) => (d.playAmount ?? 0) > 0)).toBe(true);
  });

  it("admin has debt row but fund_deduction=0 (admin doesn't owe themselves)", async () => {
    const { adminMemberId } = await seedAdminWithMember();
    const p1 = await seedMember("P1");
    const sId = await seedSession();

    await finalizeSession(
      sId,
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
          memberId: p1,
          guestName: null,
          invitedById: null,
          isGuest: false,
          attendsPlay: true,
          attendsDine: false,
        },
      ],
      0,
    );

    // Admin debt row exists
    const adminDebt = await testDb.query.sessionDebts.findFirst({
      where: and(
        eq(sessionDebts.sessionId, sId),
        eq(sessionDebts.memberId, adminMemberId),
      ),
    });
    expect(adminDebt).toBeTruthy();
    expect(adminDebt!.totalAmount).toBeGreaterThan(0);

    // BUT no fund_deduction for admin (admin doesn't deduct from themselves)
    const adminDeduction = await testDb.query.financialTransactions.findFirst({
      where: and(
        eq(financialTransactions.sessionId, sId),
        eq(financialTransactions.memberId, adminMemberId),
        eq(financialTransactions.type, "fund_deduction"),
      ),
    });
    expect(adminDeduction).toBeFalsy();

    // Non-admin DOES get deduction
    const p1Deduction = await testDb.query.financialTransactions.findFirst({
      where: and(
        eq(financialTransactions.sessionId, sId),
        eq(financialTransactions.memberId, p1),
        eq(financialTransactions.type, "fund_deduction"),
      ),
    });
    expect(p1Deduction).toBeTruthy();
    expect(p1Deduction!.amount).toBe(adminDebt!.totalAmount);
  });

  it("re-finalize with smaller attendee list — orphan ledger debtId NULL'd, no leak", async () => {
    const { adminMemberId } = await seedAdminWithMember();
    const p1 = await seedMember("P1");
    const p2 = await seedMember("P2");
    const sId = await seedSession();

    // First finalize: admin + p1 + p2
    await finalizeSession(
      sId,
      [adminMemberId, p1, p2].map((mid) => ({
        memberId: mid,
        guestName: null,
        invitedById: null,
        isGuest: false,
        attendsPlay: true,
        attendsDine: false,
      })),
      0,
    );

    let allDebts = await testDb.query.sessionDebts.findMany({
      where: eq(sessionDebts.sessionId, sId),
    });
    expect(allDebts).toHaveLength(3);

    // Re-finalize WITHOUT p2 (admin says p2 didn't actually show up)
    await testDb
      .update(sessions)
      .set({ status: "confirmed" })
      .where(eq(sessions.id, sId));
    const r = await finalizeSession(
      sId,
      [adminMemberId, p1].map((mid) => ({
        memberId: mid,
        guestName: null,
        invitedById: null,
        isGuest: false,
        attendsPlay: true,
        attendsDine: false,
      })),
      0,
    );
    expect("error" in r).toBe(false);

    // Only 2 fresh debts
    allDebts = await testDb.query.sessionDebts.findMany({
      where: eq(sessionDebts.sessionId, sId),
    });
    expect(allDebts).toHaveLength(2);
    expect(allDebts.some((d) => d.memberId === p2)).toBe(false);

    // p2's original fund_deduction is reversed (audit row stays with debtId NULL)
    const p2Txs = await testDb.query.financialTransactions.findMany({
      where: and(
        eq(financialTransactions.sessionId, sId),
        eq(financialTransactions.memberId, p2),
      ),
    });
    // Originally: 1 debt_created (neutral) + 1 fund_deduction
    // After re-finalize: + 1 reversal fund_contribution
    expect(p2Txs.length).toBeGreaterThanOrEqual(2);
    // All p2's ledger rows pointing to deleted debt have debtId=null
    expect(p2Txs.every((t) => t.debtId === null)).toBe(true);

    // p2's balance = 0 (deduction + reversal cancel)
    const p2Deductions = p2Txs.filter((t) => t.type === "fund_deduction");
    const p2Contribs = p2Txs.filter((t) => t.type === "fund_contribution");
    const dedSum = p2Deductions.reduce((s, t) => s + t.amount, 0);
    const ctbSum = p2Contribs.reduce((s, t) => s + t.amount, 0);
    expect(dedSum).toBe(ctbSum);
  });

  it("all-admin session (only admin attended) — admin debt row, no fund_deductions at all", async () => {
    const { adminMemberId } = await seedAdminWithMember();
    const sId = await seedSession();

    const r = await finalizeSession(
      sId,
      [
        {
          memberId: adminMemberId,
          guestName: null,
          invitedById: null,
          isGuest: false,
          attendsPlay: true,
          attendsDine: false,
        },
      ],
      0,
    );
    expect("error" in r).toBe(false);

    const debts = await testDb.query.sessionDebts.findMany({
      where: eq(sessionDebts.sessionId, sId),
    });
    expect(debts).toHaveLength(1);
    expect(debts[0].memberId).toBe(adminMemberId);

    // Zero fund_deduction rows (admin doesn't deduct from themselves)
    const deductions = await testDb.query.financialTransactions.findMany({
      where: and(
        eq(financialTransactions.sessionId, sId),
        eq(financialTransactions.type, "fund_deduction"),
      ),
    });
    expect(deductions).toHaveLength(0);
  });

  it("dining-only session (court=0, diningBill>0) — only dineAmount on debts", async () => {
    const { adminMemberId } = await seedAdminWithMember();
    const p1 = await seedMember("P1");
    // courtPrice=0 → no play cost, but admin has to set courtPrice for the
    // action to proceed. Use a session that has 0 players → all dine attendees.
    const sId = await seedSession({ courtPrice: 200_000, diningBill: 200_000 });

    const r = await finalizeSession(
      sId,
      [
        {
          memberId: adminMemberId,
          guestName: null,
          invitedById: null,
          isGuest: false,
          attendsPlay: false,
          attendsDine: true,
        },
        {
          memberId: p1,
          guestName: null,
          invitedById: null,
          isGuest: false,
          attendsPlay: false,
          attendsDine: true,
        },
      ],
      200_000,
    );
    expect("error" in r).toBe(false);

    const debts = await testDb.query.sessionDebts.findMany({
      where: eq(sessionDebts.sessionId, sId),
    });
    expect(debts).toHaveLength(2);
    // No play, only dine
    expect(debts.every((d) => d.playAmount === 0)).toBe(true);
    // dine per head = roundToThousand(200_000 / 2) = 100_000
    expect(debts.every((d) => d.dineAmount === 100_000)).toBe(true);
  });

  it("admin not linked to a member — rejects (would otherwise charge themselves)", async () => {
    // Admin without memberId
    const [a] = await testDb
      .insert(admins)
      .values({
        username: "orphanAdmin",
        passwordHash: "hash",
        memberId: null,
      })
      .returning({ id: admins.id });
    vi.mocked(requireAdmin).mockResolvedValue({
      admin: { sub: String(a.id), role: "admin" },
    } as never);

    const sId = await seedSession();
    const p1 = await seedMember("P1");
    const r = await finalizeSession(
      sId,
      [
        {
          memberId: p1,
          guestName: null,
          invitedById: null,
          isGuest: false,
          attendsPlay: true,
          attendsDine: false,
        },
      ],
      0,
    );
    expect("error" in r).toBe(true);
  });

  it("rejects finalize on cancelled session", async () => {
    await seedAdminWithMember();
    const p1 = await seedMember("P1");
    const sId = await seedSession();
    await testDb
      .update(sessions)
      .set({ status: "cancelled" })
      .where(eq(sessions.id, sId));

    const r = await finalizeSession(
      sId,
      [
        {
          memberId: p1,
          guestName: null,
          invitedById: null,
          isGuest: false,
          attendsPlay: true,
          attendsDine: false,
        },
      ],
      0,
    );
    expect("error" in r).toBe(true);

    // No mutation happened
    const debts = await testDb.query.sessionDebts.findMany({
      where: eq(sessionDebts.sessionId, sId),
    });
    expect(debts).toHaveLength(0);
  });

  it("admin guest count mismatch — rejects (cost-divisor protection)", async () => {
    const { adminMemberId } = await seedAdminWithMember();
    const sId = await seedSession();
    // Admin said 2 guests in session config but payload has 0
    await testDb
      .update(sessions)
      .set({ adminGuestPlayCount: 2 })
      .where(eq(sessions.id, sId));

    const r = await finalizeSession(
      sId,
      [
        {
          memberId: adminMemberId,
          guestName: null,
          invitedById: null,
          isGuest: false,
          attendsPlay: true,
          attendsDine: false,
        },
      ],
      0,
    );
    expect("error" in r).toBe(true);

    const debts = await testDb.query.sessionDebts.findMany({
      where: eq(sessionDebts.sessionId, sId),
    });
    expect(debts).toHaveLength(0);
  });
});

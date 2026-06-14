/**
 * Integration tests for finalizeSessionAuto.
 *
 * One-click finalize: build attendeeList từ vote data + admin guests, gọi
 * finalizeSession trực tiếp. Tests cover:
 *  - Rejects when session already completed/cancelled
 *  - Rejects when admin not linked to a member
 *  - Build attendee list from willPlay/willDine votes (only one of either)
 *  - Adds guests from guestPlayCount + guestDineCount per voter
 *  - Adds admin guests from session.adminGuestPlay/Dine counts
 *  - Uses session.diningBill (already set)
 *  - End-to-end: results in sessionAttendees + sessionDebts + fund_deductions
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  sessions,
  admins,
  members,
  votes,
  sessionAttendees,
  sessionDebts,
  financialTransactions,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
}));
vi.mock("@/lib/messenger", () => ({
  sendGroupMessage: vi.fn(),
  buildNewSessionMessage: vi.fn(() => ""),
  buildConfirmedMessage: vi.fn(() => ""),
  buildDebtReminderMessage: vi.fn(() => ""),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { finalizeSessionAuto } = await import("./finance");
import { requireAdmin } from "@/lib/auth";

async function reset() {
  await client.execute("DELETE FROM financial_transactions");
  await client.execute("DELETE FROM session_debts");
  await client.execute("DELETE FROM session_attendees");
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

async function seedAdminWithMember(memberName = "Admin") {
  const memberId = await seedMember(memberName);
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

async function seedSession(opts: {
  status?: "voting" | "confirmed" | "completed" | "cancelled";
  courtPrice?: number;
  diningBill?: number;
  adminGuestPlay?: number;
  adminGuestDine?: number;
}) {
  const [s] = await testDb
    .insert(sessions)
    .values({
      date: "2026-04-10",
      status: opts.status ?? "confirmed",
      courtPrice: opts.courtPrice ?? 200_000,
      diningBill: opts.diningBill ?? 0,
      adminGuestPlayCount: opts.adminGuestPlay ?? 0,
      adminGuestDineCount: opts.adminGuestDine ?? 0,
    })
    .returning({ id: sessions.id });
  return s.id;
}

async function seedVote(
  sessionId: number,
  memberId: number,
  opts: {
    willPlay?: boolean;
    willDine?: boolean;
    guestPlayCount?: number;
    guestDineCount?: number;
  } = {},
) {
  await testDb.insert(votes).values({
    sessionId,
    memberId,
    willPlay: opts.willPlay ?? false,
    willDine: opts.willDine ?? false,
    guestPlayCount: opts.guestPlayCount ?? 0,
    guestDineCount: opts.guestDineCount ?? 0,
  });
}

describe("finalizeSessionAuto (integration)", () => {
  beforeEach(async () => await reset());

  it("rejects completed session", async () => {
    await seedAdminWithMember();
    const sId = await seedSession({ status: "completed" });
    const r = await finalizeSessionAuto(sId);
    expect("error" in r).toBe(true);
  });

  it("rejects cancelled session", async () => {
    await seedAdminWithMember();
    const sId = await seedSession({ status: "cancelled" });
    const r = await finalizeSessionAuto(sId);
    expect("error" in r).toBe(true);
  });

  it("rejects when admin has no linked member", async () => {
    // Create admin WITHOUT memberId
    const [a] = await testDb
      .insert(admins)
      .values({ username: "noMember", passwordHash: "hash", memberId: null })
      .returning({ id: admins.id });
    vi.mocked(requireAdmin).mockResolvedValue({
      admin: { sub: String(a.id), role: "admin" },
    } as never);

    const sId = await seedSession({ status: "confirmed" });
    const r = await finalizeSessionAuto(sId);
    expect("error" in r).toBe(true);
  });

  it("builds attendees from willPlay/willDine votes + creates debts", async () => {
    const { adminMemberId } = await seedAdminWithMember();
    const p1 = await seedMember("P1");
    const p2 = await seedMember("P2");

    const sId = await seedSession({ courtPrice: 200_000, status: "confirmed" });
    await seedVote(sId, p1, { willPlay: true });
    await seedVote(sId, p2, { willPlay: true });
    await seedVote(sId, adminMemberId, { willPlay: true });

    const r = await finalizeSessionAuto(sId);
    expect("error" in r).toBe(false);

    // 3 attendees
    const att = await testDb.query.sessionAttendees.findMany({
      where: eq(sessionAttendees.sessionId, sId),
    });
    expect(att).toHaveLength(3);
    expect(att.every((a) => a.attendsPlay && !a.attendsDine)).toBe(true);

    // 3 debts + 3 fund_deductions (admin now charged for own play, new design)
    const debts = await testDb.query.sessionDebts.findMany({
      where: eq(sessionDebts.sessionId, sId),
    });
    expect(debts).toHaveLength(3);

    const ded = await testDb.query.financialTransactions.findMany({
      where: and(
        eq(financialTransactions.sessionId, sId),
        eq(financialTransactions.type, "fund_deduction"),
      ),
    });
    expect(ded).toHaveLength(3);
    expect(ded.every((d) => d.amount > 0)).toBe(true);
  });

  it("adds guests per voter (guestPlayCount + guestDineCount)", async () => {
    const { adminMemberId } = await seedAdminWithMember();
    const p1 = await seedMember("P1");

    const sId = await seedSession({ courtPrice: 200_000, status: "confirmed" });
    // p1: 1 play guest + 2 dine guests
    await seedVote(sId, p1, {
      willPlay: true,
      guestPlayCount: 1,
      guestDineCount: 2,
    });
    await seedVote(sId, adminMemberId, { willPlay: true });

    const r = await finalizeSessionAuto(sId);
    expect("error" in r).toBe(false);

    const att = await testDb.query.sessionAttendees.findMany({
      where: eq(sessionAttendees.sessionId, sId),
    });
    // 2 members + 1 play guest + 2 dine guests = 5
    expect(att).toHaveLength(5);
    const guests = att.filter((a) => a.isGuest);
    expect(guests).toHaveLength(3);
    const playGuests = guests.filter((g) => g.attendsPlay && !g.attendsDine);
    const dineGuests = guests.filter((g) => g.attendsDine && !g.attendsPlay);
    expect(playGuests).toHaveLength(1);
    expect(dineGuests).toHaveLength(2);
    expect(guests.every((g) => g.invitedById === p1)).toBe(true);
  });

  it("adds admin guests from session.adminGuestPlay/Dine counts", async () => {
    const { adminMemberId } = await seedAdminWithMember();
    const p1 = await seedMember("P1");

    const sId = await seedSession({
      courtPrice: 200_000,
      status: "confirmed",
      adminGuestPlay: 2,
      adminGuestDine: 1,
    });
    await seedVote(sId, p1, { willPlay: true });
    await seedVote(sId, adminMemberId, { willPlay: true });

    const r = await finalizeSessionAuto(sId);
    expect("error" in r).toBe(false);

    const att = await testDb.query.sessionAttendees.findMany({
      where: eq(sessionAttendees.sessionId, sId),
    });
    // 2 members + 2 admin-play-guests + 1 admin-dine-guest = 5
    expect(att).toHaveLength(5);
    const adminGuests = att.filter(
      (a) => a.isGuest && a.invitedById === adminMemberId,
    );
    expect(adminGuests).toHaveLength(3);
    expect(adminGuests.filter((g) => g.attendsPlay)).toHaveLength(2);
    expect(adminGuests.filter((g) => g.attendsDine)).toHaveLength(1);
  });

  it("uses session.diningBill — creates dineAmount on debts", async () => {
    const { adminMemberId } = await seedAdminWithMember();
    const p1 = await seedMember("P1");

    const sId = await seedSession({
      courtPrice: 200_000,
      status: "confirmed",
      diningBill: 200_000,
    });
    await seedVote(sId, p1, { willPlay: true, willDine: true });
    await seedVote(sId, adminMemberId, { willPlay: true, willDine: true });

    const r = await finalizeSessionAuto(sId);
    expect("error" in r).toBe(false);

    const debts = await testDb.query.sessionDebts.findMany({
      where: eq(sessionDebts.sessionId, sId),
    });
    // 2 attendees both attendsDine → dineCost split between 2
    // dineCostPerHead = roundToThousand(200_000 / 2) = 100_000
    expect(debts.every((d) => d.dineAmount === 100_000)).toBe(true);
  });

  it("skips voters with willPlay=false AND willDine=false (no guests either)", async () => {
    const { adminMemberId } = await seedAdminWithMember();
    const p1 = await seedMember("P1");
    const p2 = await seedMember("P2");

    const sId = await seedSession({ status: "confirmed" });
    // p1 voted no for everything
    await seedVote(sId, p1, {});
    await seedVote(sId, p2, { willPlay: true });
    await seedVote(sId, adminMemberId, { willPlay: true });

    const r = await finalizeSessionAuto(sId);
    expect("error" in r).toBe(false);

    const att = await testDb.query.sessionAttendees.findMany({
      where: eq(sessionAttendees.sessionId, sId),
    });
    // Only p2 + admin (p1 absent → no attendee row created from his "no" vote)
    expect(att).toHaveLength(2);
    expect(att.find((a) => a.memberId === p1)).toBeUndefined();
  });

  it("charges fund members via ledger fund_deduction (merged Quỹ + Nợ model)", async () => {
    // Post-refactor: không còn bảng fund_members. Roster quỹ derive từ
    // members.isActive=true AND approvalStatus='approved' (mặc định khi insert).
    // "Enrolled into fund" giờ thể hiện qua: member là roster member +
    // finalize ghi một fund_deduction vào ledger cho họ.
    const { adminMemberId } = await seedAdminWithMember();
    const newMid = await seedMember("NewMember");

    const sId = await seedSession({ status: "confirmed" });
    await seedVote(sId, newMid, { willPlay: true });
    await seedVote(sId, adminMemberId, { willPlay: true });

    const r = await finalizeSessionAuto(sId);
    expect("error" in r).toBe(false);

    // Member tự động trong quỹ (active + approved by default).
    const m = await testDb.query.members.findFirst({
      where: eq(members.id, newMid),
      columns: { isActive: true, approvalStatus: true },
    });
    expect(m?.isActive).toBe(true);
    expect(m?.approvalStatus).toBe("approved");

    // finalize ghi fund_deduction cho member vào ledger (merged Quỹ + Nợ).
    const ded = await testDb.query.financialTransactions.findMany({
      where: and(
        eq(financialTransactions.sessionId, sId),
        eq(financialTransactions.memberId, newMid),
        eq(financialTransactions.type, "fund_deduction"),
      ),
    });
    expect(ded).toHaveLength(1);
    expect(ded[0].amount).toBeGreaterThan(0);
  });
});

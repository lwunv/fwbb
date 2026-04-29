/**
 * Integration tests cho `finalizeSession` đối chiếu adminGuestCount.
 *
 * Audit High #11: nếu admin đã set `adminGuestPlayCount=N` ở
 * `setAdminGuestCount` nhưng UI chốt sổ không expand đúng N row guest cho
 * admin → tổng player chia tiền giảm đi N → các member khác trả thừa.
 *
 * Sau fix: `finalizeSession` đối chiếu `attendeeList` với
 * `sessions.adminGuestPlayCount` / `adminGuestDineCount`. Nếu số guest do
 * admin mời (`invitedById === admin.memberId AND isGuest === true`) trong
 * payload < số đã set → trả error.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  members,
  sessions,
  sessionDebts,
  admins as adminsTable,
} from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
  getAdminFromCookie: vi.fn(async () => ({ sub: "1", role: "admin" })),
}));
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
  await client.execute("DELETE FROM session_debts");
  await client.execute("DELETE FROM session_attendees");
  await client.execute("DELETE FROM session_shuttlecocks");
  await client.execute("DELETE FROM votes");
  await client.execute("DELETE FROM fund_members");
  await client.execute("DELETE FROM sessions");
  await client.execute("DELETE FROM admins");
  await client.execute("DELETE FROM members");
}

async function seed() {
  const [admin, alice, bob] = await testDb
    .insert(members)
    .values([
      { name: "Admin", facebookId: "fb-admin" },
      { name: "Alice", facebookId: "fb-a" },
      { name: "Bob", facebookId: "fb-b" },
    ])
    .returning({ id: members.id });
  await testDb.insert(adminsTable).values({
    username: "Admin",
    passwordHash: "x",
    memberId: admin.id,
  });
  return { adminId: admin.id, aliceId: alice.id, bobId: bob.id };
}

async function seedSession(opts: {
  adminGuestPlayCount: number;
  adminGuestDineCount: number;
}) {
  const [s] = await testDb
    .insert(sessions)
    .values({
      date: "2026-04-20",
      status: "confirmed",
      courtPrice: 200_000,
      adminGuestPlayCount: opts.adminGuestPlayCount,
      adminGuestDineCount: opts.adminGuestDineCount,
    })
    .returning({ id: sessions.id });
  return s.id;
}

describe("finalizeSession — adminGuestCount validation", () => {
  beforeEach(reset);

  it("rejects when payload has fewer admin-invited guests than session.adminGuestPlayCount", async () => {
    const { adminId, aliceId } = await seed();
    const sessionId = await seedSession({
      adminGuestPlayCount: 2,
      adminGuestDineCount: 0,
    });

    const r = await finalizeSession(
      sessionId,
      [
        // admin + alice; NO admin guests despite session expecting 2
        {
          memberId: adminId,
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

    expect("error" in r).toBe(true);
    // No debts written
    const debts = await testDb.query.sessionDebts.findMany({
      where: eq(sessionDebts.sessionId, sessionId),
    });
    expect(debts).toHaveLength(0);
  });

  it("accepts when payload has at least the expected number of admin guests", async () => {
    const { adminId, aliceId } = await seed();
    const sessionId = await seedSession({
      adminGuestPlayCount: 1,
      adminGuestDineCount: 0,
    });

    const r = await finalizeSession(
      sessionId,
      [
        {
          memberId: adminId,
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
          memberId: null,
          guestName: "Admin Guest",
          invitedById: adminId,
          isGuest: true,
          attendsPlay: true,
          attendsDine: false,
        },
      ],
      0,
    );

    expect("error" in r).toBe(false);
  });

  it("accepts when adminGuestPlayCount=0 (no constraint)", async () => {
    const { adminId, aliceId } = await seed();
    const sessionId = await seedSession({
      adminGuestPlayCount: 0,
      adminGuestDineCount: 0,
    });

    const r = await finalizeSession(
      sessionId,
      [
        {
          memberId: adminId,
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

    expect("error" in r).toBe(false);
  });

  it("rejects when adminGuestDineCount missing in payload", async () => {
    const { adminId, aliceId } = await seed();
    const sessionId = await seedSession({
      adminGuestPlayCount: 0,
      adminGuestDineCount: 1,
    });

    const r = await finalizeSession(
      sessionId,
      [
        {
          memberId: adminId,
          guestName: null,
          invitedById: null,
          isGuest: false,
          attendsPlay: false,
          attendsDine: true,
        },
        {
          memberId: aliceId,
          guestName: null,
          invitedById: null,
          isGuest: false,
          attendsPlay: false,
          attendsDine: true,
        },
      ],
      300_000,
    );

    expect("error" in r).toBe(true);
  });

  it("rejects finalize when admin record has no linked memberId (even with no admin guests)", async () => {
    // After H7: admin MUST be linked to a member record at finalize time.
    // Without the link, the cost loop would treat admin's row as a regular
    // member and write a debt + fund_deduction for them ("admin pays
    // themselves") — silent financial inconsistency.
    //
    // Use admin username "SuperAdmin" (no member with this name) so the
    // resolveAdminMemberId fallback (matching `members.name === username`)
    // returns null too — exactly the broken-link scenario we're guarding.
    const [alice] = await testDb
      .insert(members)
      .values([{ name: "Alice", facebookId: "fb-a2" }])
      .returning({ id: members.id });
    await testDb.insert(adminsTable).values({
      username: "SuperAdmin",
      passwordHash: "x",
      memberId: null,
    });
    const sessionId = await seedSession({
      adminGuestPlayCount: 0,
      adminGuestDineCount: 0,
    });

    const r = await finalizeSession(
      sessionId,
      [
        {
          memberId: alice.id,
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
      where: eq(sessionDebts.sessionId, sessionId),
    });
    expect(debts).toHaveLength(0);
  });

  it("re-finalize is clean: orphan debt-scoped ledger refs are nulled before delete", async () => {
    // After H14: when admin re-finalizes (e.g., to correct attendee list),
    // pre-existing debt_created/debt_member_confirmed/etc rows must have
    // their `debtId` set to NULL before the matching sessionDebts row is
    // deleted. Otherwise reconcile invariant I7 fires and audit history
    // dangles.
    const { adminId, aliceId } = await seed();
    const sessionId = await seedSession({
      adminGuestPlayCount: 0,
      adminGuestDineCount: 0,
    });

    const r1 = await finalizeSession(
      sessionId,
      [
        {
          memberId: adminId,
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
    expect("error" in r1).toBe(false);

    // Now re-finalize — admin removed Alice from the attendee list.
    const r2 = await finalizeSession(
      sessionId,
      [
        {
          memberId: adminId,
          guestName: null,
          invitedById: null,
          isGuest: false,
          attendsPlay: true,
          attendsDine: false,
        },
      ],
      0,
    );
    expect("error" in r2).toBe(false);

    // Any ledger row whose debtId still points at a non-existent
    // sessionDebts row would be a violation. Verify all surviving
    // debt_created rows reference EXISTING debts.
    const allDebtCreated = await testDb.query.financialTransactions.findMany({
      where: (t, { eq, and: aFn }) =>
        aFn(eq(t.sessionId, sessionId), eq(t.type, "debt_created")),
    });
    const surviving = await testDb.query.sessionDebts.findMany({
      where: eq(sessionDebts.sessionId, sessionId),
    });
    const survivingIds = new Set(surviving.map((d) => d.id));
    for (const tx of allDebtCreated) {
      if (tx.debtId !== null) {
        expect(survivingIds.has(tx.debtId)).toBe(true);
      }
    }
  });
});

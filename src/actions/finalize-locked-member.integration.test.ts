/**
 * Guard: member đã khóa / rời quỹ (isActive=false hoặc chưa approved) KHÔNG
 * được tính nợ khi finalize — nếu không sẽ bị trừ quỹ (balance âm) trái với
 * spec "khóa = đóng băng balance". Admin phải bỏ họ khỏi buổi trước khi chốt.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  sessions,
  admins,
  members,
  financialTransactions,
  votes,
  sessionDebts,
} from "@/db/schema";
import { eq } from "drizzle-orm";

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

const { finalizeSession, finalizeSessionAuto } = await import("./finance");
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

async function seedAdmin() {
  const [m] = await testDb
    .insert(members)
    .values({ name: "Admin", facebookId: `fb-admin-${Date.now()}` })
    .returning({ id: members.id });
  const [a] = await testDb
    .insert(admins)
    .values({ username: `a${Date.now()}`, passwordHash: "h", memberId: m.id })
    .returning({ id: admins.id });
  vi.mocked(requireAdmin).mockResolvedValue({
    admin: { sub: String(a.id), role: "admin" },
  } as never);
  return m.id;
}

function attendee(memberId: number) {
  return {
    memberId,
    guestName: null,
    invitedById: null,
    isGuest: false,
    attendsPlay: true,
    attendsDine: false,
  };
}

describe("finalizeSession guard — member đã khóa", () => {
  beforeEach(reset);

  it("reject finalize khi danh sách có member isActive=false; KHÔNG trừ quỹ họ", async () => {
    const adminMemberId = await seedAdmin();
    const [locked] = await testDb
      .insert(members)
      .values({
        name: "LockedGuy",
        facebookId: `fb-locked-${Date.now()}`,
        isActive: false,
      })
      .returning({ id: members.id });
    const [s] = await testDb
      .insert(sessions)
      .values({ date: "2026-04-10", status: "confirmed", courtPrice: 200_000 })
      .returning({ id: sessions.id });

    const r = await finalizeSession(
      s.id,
      [attendee(adminMemberId), attendee(locked.id)],
      0,
    );

    expect("error" in r).toBe(true);
    const deductions = await testDb.query.financialTransactions.findMany({
      where: eq(financialTransactions.memberId, locked.id),
    });
    expect(deductions.length).toBe(0);
  });

  it("finalize OK khi mọi member active+approved", async () => {
    const adminMemberId = await seedAdmin();
    const [p1] = await testDb
      .insert(members)
      .values({ name: "P1", facebookId: `fb-p1-${Date.now()}` })
      .returning({ id: members.id });
    const [s] = await testDb
      .insert(sessions)
      .values({ date: "2026-04-11", status: "confirmed", courtPrice: 200_000 })
      .returning({ id: sessions.id });

    const r = await finalizeSession(
      s.id,
      [attendee(adminMemberId), attendee(p1.id)],
      0,
    );

    expect("error" in r).toBe(false);
  });

  it("finalizeSessionAuto bỏ qua voter đã khóa, vẫn chốt + không trừ quỹ họ", async () => {
    const adminMemberId = await seedAdmin();
    const [active] = await testDb
      .insert(members)
      .values({ name: "Active", facebookId: `fb-act-${Date.now()}` })
      .returning({ id: members.id });
    const [locked] = await testDb
      .insert(members)
      .values({
        name: "Locked",
        facebookId: `fb-lock-${Date.now()}`,
        isActive: false,
      })
      .returning({ id: members.id });
    const [s] = await testDb
      .insert(sessions)
      .values({ date: "2026-04-12", status: "voting", courtPrice: 200_000 })
      .returning({ id: sessions.id });
    for (const mid of [adminMemberId, active.id, locked.id]) {
      await testDb
        .insert(votes)
        .values({ sessionId: s.id, memberId: mid, willPlay: true });
    }

    const r = await finalizeSessionAuto(s.id);
    // Guard KHÔNG được làm hỏng one-click finalize: locked voter bị bỏ qua.
    expect("error" in r).toBe(false);

    const lockedDebts = await testDb.query.sessionDebts.findMany({
      where: eq(sessionDebts.memberId, locked.id),
    });
    expect(lockedDebts.length).toBe(0);
    const lockedDed = await testDb.query.financialTransactions.findMany({
      where: eq(financialTransactions.memberId, locked.id),
    });
    expect(lockedDed.length).toBe(0);
    const activeDebts = await testDb.query.sessionDebts.findMany({
      where: eq(sessionDebts.memberId, active.id),
    });
    expect(activeDebts.length).toBe(1);
  });
});

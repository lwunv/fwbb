/**
 * Lớp chặn thứ hai cho các hàm đọc nhóm: layout và page đã chặn tài khoản chưa
 * duyệt, nhưng server action gọi thẳng được, nên chính hàm đọc phải tự kiểm.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members, sessions, sessionAttendees, sessionDebts } from "@/db/schema";

const who = vi.hoisted(() => ({
  admin: false,
  memberId: null as number | null,
}));
vi.mock("@/lib/auth", () => ({
  getAdminFromCookie: vi.fn(async () => (who.admin ? { role: "admin" } : null)),
  requireAdmin: vi.fn(async () =>
    who.admin
      ? { admin: { role: "admin" } }
      : { error: "Không có quyền admin" },
  ),
}));
vi.mock("@/lib/user-identity", () => ({
  getUserFromCookie: vi.fn(async () =>
    who.memberId ? { memberId: who.memberId, externalId: "x" } : null,
  ),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { getMonthlyExpenses, getActiveMembersStats, getAttendanceTrend } =
  await import("./stats");
const { getAdminUpcomingSession } = await import("./sessions");
const { requireApprovedOrAdmin } = await import("@/lib/approved-or-admin");

function today() {
  return new Date().toISOString().split("T")[0];
}

async function mkMember(approvalStatus: "pending" | "approved") {
  const [m] = await testDb
    .insert(members)
    .values({ name: `M-${approvalStatus}`, approvalStatus })
    .returning({ id: members.id });
  return m.id;
}

/** 1 buổi completed gần đây + 1 attendee + 1 debt cho `memberId`. */
async function seedCompleted(memberId: number) {
  const [s] = await testDb
    .insert(sessions)
    .values({
      date: today(),
      status: "completed",
      courtPrice: 200000,
      diningBill: 100000,
    })
    .returning({ id: sessions.id });
  await testDb.insert(sessionAttendees).values({
    sessionId: s.id,
    memberId,
    attendsPlay: true,
    attendsDine: false,
  });
  await testDb.insert(sessionDebts).values({
    sessionId: s.id,
    memberId,
    playAmount: 50000,
    dineAmount: 0,
    totalAmount: 50000,
  });
}

beforeEach(async () => {
  who.admin = false;
  who.memberId = null;
  for (const t of [
    "session_debts",
    "session_attendees",
    "session_shuttlecocks",
    "votes",
    "sessions",
    "members",
  ]) {
    await client.execute(`DELETE FROM ${t}`);
  }
});

describe("requireApprovedOrAdmin", () => {
  it("admin ok; approved ok; pending/không cookie lỗi", async () => {
    who.admin = true;
    expect(await requireApprovedOrAdmin()).toEqual({ ok: true });

    who.admin = false;
    expect(await requireApprovedOrAdmin()).toHaveProperty("error");

    who.memberId = await mkMember("pending");
    expect(await requireApprovedOrAdmin()).toHaveProperty("error");

    who.memberId = await mkMember("approved");
    expect(await requireApprovedOrAdmin()).toEqual({ ok: true });
  });
});

describe("getMonthlyExpenses", () => {
  it("toàn nhóm: không phải admin (không cookie / pending / approved) → []", async () => {
    const approved = await mkMember("approved");
    await seedCompleted(approved);

    expect(await getMonthlyExpenses("month", null)).toEqual([]);
    who.memberId = await mkMember("pending");
    expect(await getMonthlyExpenses("month", null)).toEqual([]);
    who.memberId = approved;
    expect(await getMonthlyExpenses("month", null)).toEqual([]);
  });

  it("toàn nhóm: admin → có dữ liệu", async () => {
    await seedCompleted(await mkMember("approved"));
    who.admin = true;
    const rows = await getMonthlyExpenses("month", null);
    expect(rows).toHaveLength(1);
    expect(rows[0].courtCost).toBe(200000);
  });

  it("của chính mình: member approved vẫn có dữ liệu của mình", async () => {
    const approved = await mkMember("approved");
    await seedCompleted(approved);
    who.memberId = approved;
    const rows = await getMonthlyExpenses("month", approved);
    expect(rows).toHaveLength(1);
    expect(rows[0].total).toBeGreaterThan(0);
  });

  it("của chính mình: member chưa duyệt → []", async () => {
    const pending = await mkMember("pending");
    await seedCompleted(pending);
    who.memberId = pending;
    expect(await getMonthlyExpenses("month", pending)).toEqual([]);
  });
});

describe("getActiveMembersStats / getAttendanceTrend", () => {
  it("pending → []; approved → có dữ liệu; admin → có dữ liệu", async () => {
    const approved = await mkMember("approved");
    await seedCompleted(approved);

    who.memberId = await mkMember("pending");
    expect(await getActiveMembersStats("all")).toEqual([]);
    expect(await getAttendanceTrend()).toEqual([]);

    who.memberId = approved;
    expect(await getActiveMembersStats("all")).toHaveLength(1);
    expect(await getAttendanceTrend()).toHaveLength(1);

    who.memberId = null;
    who.admin = true;
    expect(await getActiveMembersStats("all")).toHaveLength(1);
    expect(await getAttendanceTrend()).toHaveLength(1);
  });

  it("không cookie → []", async () => {
    await seedCompleted(await mkMember("approved"));
    expect(await getActiveMembersStats("all")).toEqual([]);
    expect(await getAttendanceTrend()).toEqual([]);
  });
});

describe("getAdminUpcomingSession", () => {
  it("không phải admin → không INSERT session, trả undefined", async () => {
    expect(await getAdminUpcomingSession()).toBeUndefined();
    who.memberId = await mkMember("approved");
    expect(await getAdminUpcomingSession()).toBeUndefined();
    const rows = await client.execute("SELECT COUNT(*) AS n FROM sessions");
    expect(Number(rows.rows[0].n)).toBe(0);
  });
});

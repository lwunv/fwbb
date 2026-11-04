import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members, notifications } from "@/db/schema";
import { eq } from "drizzle-orm";

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const userMock = vi.hoisted(() => ({
  getUserFromCookie:
    vi.fn<() => Promise<{ memberId: number; externalId: string } | null>>(),
}));
vi.mock("@/lib/user-identity", () => userMock);
const authMock = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
}));
vi.mock("@/lib/auth", () => authMock);

const {
  getUnreadNotificationCount,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} = await import("./notifications");
const { enableNotificationsForTest } =
  await import("@/lib/notifications/test-helpers");

async function reset() {
  for (const t of ["notifications", "members", "app_settings"]) {
    await client.execute(`DELETE FROM ${t}`);
  }
}

async function addMember(
  name: string,
  opts: {
    isActive?: boolean;
    approvalStatus?: "pending" | "approved" | "rejected";
  } = {},
) {
  const [m] = await testDb
    .insert(members)
    .values({
      name,
      facebookId: `fb-${name}`,
      isActive: opts.isActive ?? true,
      approvalStatus: opts.approvalStatus ?? "approved",
    })
    .returning({ id: members.id });
  return m.id;
}

let seq = 0;
async function addNotif(
  recipientType: "member" | "admin",
  recipientId: number,
  opts: { kind?: string; readAt?: string | null; createdAt?: string } = {},
) {
  seq++;
  const [row] = await testDb
    .insert(notifications)
    .values({
      recipientType,
      recipientId,
      kind: opts.kind ?? "session_opened",
      payload: {},
      readAt: opts.readAt ?? null,
      createdAt:
        opts.createdAt ??
        new Date(Date.UTC(2026, 10, 1, 0, 0, seq)).toISOString(),
      dedupKey: `k${seq}`,
    })
    .returning({ id: notifications.id });
  return row.id;
}

function loginMember(memberId: number | null) {
  userMock.getUserFromCookie.mockResolvedValue(
    memberId === null ? null : { memberId, externalId: "x" },
  );
}

async function readRow(id: number) {
  const [row] = await testDb
    .select()
    .from(notifications)
    .where(eq(notifications.id, id));
  return row;
}

beforeEach(async () => {
  await reset();
  await enableNotificationsForTest(testDb);
  seq = 0;
  loginMember(null);
  authMock.requireAdmin.mockReset();
  authMock.requireAdmin.mockResolvedValue({ error: "no" });
});

describe("notification actions", () => {
  it("count caps at 100 and ignores read rows", async () => {
    const m = await addMember("A");
    loginMember(m);
    for (let i = 0; i < 105; i++) await addNotif("member", m);
    for (let i = 0; i < 3; i++)
      await addNotif("member", m, { readAt: "2026-11-02T00:00:00.000Z" });
    expect(await getUnreadNotificationCount("member")).toBe(100);

    await client.execute("DELETE FROM notifications");
    await addNotif("member", m);
    await addNotif("member", m, { readAt: "2026-11-02T00:00:00.000Z" });
    expect(await getUnreadNotificationCount("member")).toBe(1);
  });

  it("count is 0 when nobody is logged in or the switch is off", async () => {
    const m = await addMember("A");
    await addNotif("member", m);
    expect(await getUnreadNotificationCount("member")).toBe(0);
    loginMember(m);
    expect(await getUnreadNotificationCount("member")).toBe(1);
    await client.execute("DELETE FROM app_settings");
    expect(await getUnreadNotificationCount("member")).toBe(0);
  });

  it("list returns 20 newest then pages by cursor without duplicates", async () => {
    const m = await addMember("A");
    loginMember(m);
    // 5 tin mới nhất trùng createdAt để thử tie-break theo id.
    const ids: number[] = [];
    for (let i = 0; i < 20; i++) ids.push(await addNotif("member", m));
    for (let i = 0; i < 5; i++)
      ids.push(
        await addNotif("member", m, { createdAt: "2026-12-01T00:00:00.000Z" }),
      );
    const first = await listNotifications("member", null);
    if ("error" in first) throw new Error(first.error);
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).not.toBeNull();
    expect(first.items.slice(0, 5).map((i) => i.id)).toEqual(
      ids.slice(20).reverse(),
    );
    const second = await listNotifications("member", first.nextCursor);
    if ("error" in second) throw new Error(second.error);
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    const all = [...first.items, ...second.items].map((i) => i.id);
    expect(new Set(all).size).toBe(25);
  });

  it("member cannot read or mark another member's notification", async () => {
    const a = await addMember("A");
    const b = await addMember("B");
    const bNotif = await addNotif("member", b);
    await addNotif("member", a);
    loginMember(a);
    const res = await listNotifications("member", null);
    if ("error" in res) throw new Error(res.error);
    expect(res.items.map((i) => i.id)).not.toContain(bNotif);
    await markNotificationRead("member", bNotif);
    expect((await readRow(bNotif)).readAt).toBeNull();
  });

  it("a member cannot mark an admin row that shares the recipient id", async () => {
    const a = await addMember("A");
    const adminNotif = await addNotif("admin", a, { kind: "signup_pending" });
    loginMember(a);
    await markNotificationRead("member", adminNotif);
    expect((await readRow(adminNotif)).readAt).toBeNull();
  });

  it("marks own notification read with an ISO UTC time", async () => {
    const a = await addMember("A");
    const id = await addNotif("member", a);
    loginMember(a);
    expect(await markNotificationRead("member", id)).toEqual({
      success: true,
    });
    expect((await readRow(id)).readAt).toMatch(/Z$/);
  });

  it("admin scope without admin cookie returns error / 0", async () => {
    await addNotif("admin", 1, { kind: "signup_pending" });
    expect(await getUnreadNotificationCount("admin")).toBe(0);
    expect(await listNotifications("admin", null)).toHaveProperty("error");
    expect(await markNotificationRead("admin", 1)).toHaveProperty("error");
    expect(await markAllNotificationsRead("admin")).toHaveProperty("error");
  });

  it("admin scope reads the admin's own rows only", async () => {
    authMock.requireAdmin.mockResolvedValue({
      admin: { sub: "7", role: "admin" },
    });
    await addNotif("admin", 7, { kind: "signup_pending" });
    await addNotif("admin", 8, { kind: "signup_pending" });
    await addNotif("member", 7);
    expect(await getUnreadNotificationCount("admin")).toBe(1);
    const res = await listNotifications("admin", null);
    if ("error" in res) throw new Error(res.error);
    expect(res.items).toHaveLength(1);
  });

  it("exchange pending account sees own notifications; rejected sees only account-group notifications; locked (isActive=false) sees none", async () => {
    const pending = await addMember("P", { approvalStatus: "pending" });
    await addNotif("member", pending);
    loginMember(pending);
    expect(await getUnreadNotificationCount("member")).toBe(1);

    const rejected = await addMember("R", { approvalStatus: "rejected" });
    const accountKind = "account_rejected";
    const otherId = await addNotif("member", rejected, {
      kind: "session_opened",
    });
    const accId = await addNotif("member", rejected, { kind: accountKind });
    loginMember(rejected);
    expect(await getUnreadNotificationCount("member")).toBe(1);
    const res = await listNotifications("member", null);
    if ("error" in res) throw new Error(res.error);
    expect(res.items.map((i) => i.kind)).toEqual([accountKind]);
    // Tin nhóm khác: đánh dấu từng cái và đánh dấu tất cả đều không có tác dụng.
    await markNotificationRead("member", otherId);
    expect((await readRow(otherId)).readAt).toBeNull();
    await markAllNotificationsRead("member");
    expect((await readRow(otherId)).readAt).toBeNull();
    expect((await readRow(accId)).readAt).not.toBeNull();

    const locked = await addMember("L", { isActive: false });
    await addNotif("member", locked);
    loginMember(locked);
    expect(await getUnreadNotificationCount("member")).toBe(0);
    expect(await listNotifications("member", null)).toHaveProperty("error");
    expect(await markAllNotificationsRead("member")).toHaveProperty("error");
  });

  it("rejected member paging is not shortened by non-account rows", async () => {
    const r = await addMember("R", { approvalStatus: "rejected" });
    loginMember(r);
    for (let i = 0; i < 30; i++)
      await addNotif("member", r, { kind: "account_rejected" });
    for (let i = 0; i < 30; i++)
      await addNotif("member", r, { kind: "session_opened" });
    const res = await listNotifications("member", null);
    if ("error" in res) throw new Error(res.error);
    expect(res.items).toHaveLength(20);
    expect(res.nextCursor).not.toBeNull();
  });

  it("markAll only touches the caller's rows", async () => {
    const a = await addMember("A");
    const b = await addMember("B");
    await addNotif("member", a);
    await addNotif("member", a);
    await addNotif("member", b);
    await addNotif("admin", a, { kind: "signup_pending" });
    loginMember(a);
    expect(await markAllNotificationsRead("member")).toEqual({
      success: true,
    });
    const rows = await testDb.select().from(notifications);
    for (const r of rows) {
      const mine = r.recipientType === "member" && r.recipientId === a;
      expect(r.readAt !== null).toBe(mine);
    }
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members, notificationPrefs, notifications } from "@/db/schema";
import { and, eq } from "drizzle-orm";

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const userMock = vi.hoisted(() => ({
  getUserFromCookie:
    vi.fn<() => Promise<{ memberId: number; externalId: string } | null>>(),
}));
vi.mock("@/lib/user-identity", () => userMock);
const authMock = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

const { getMyNotificationPrefs, updateMyNotificationPrefs } =
  await import("./notifications");
const { notify } = await import("@/lib/notifications/notify");
const { enableNotificationsForTest } =
  await import("@/lib/notifications/test-helpers");

async function reset() {
  for (const t of [
    "notification_prefs",
    "notifications",
    "members",
    "app_settings",
  ]) {
    await client.execute(`DELETE FROM ${t}`);
  }
}

async function addMember(name: string, email: string | null = null) {
  const [m] = await testDb
    .insert(members)
    .values({
      name,
      facebookId: `fb-${name}`,
      isActive: true,
      approvalStatus: "approved",
      email,
    })
    .returning({ id: members.id });
  return m.id;
}

const prefsRows = (memberId: number) =>
  testDb
    .select()
    .from(notificationPrefs)
    .where(
      and(
        eq(notificationPrefs.recipientType, "member"),
        eq(notificationPrefs.recipientId, memberId),
      ),
    );

beforeEach(async () => {
  await reset();
  await enableNotificationsForTest(testDb);
  userMock.getUserFromCookie.mockResolvedValue(null);
  authMock.requireAdmin.mockReset();
  authMock.requireAdmin.mockResolvedValue({ error: "no" });
});

describe("notification prefs actions", () => {
  it("prefs: member cannot mute an admin group; muting session then notify(session_opened) skips the member", async () => {
    const a = await addMember("A");
    const b = await addMember("B");
    userMock.getUserFromCookie.mockResolvedValue({
      memberId: a,
      externalId: "x",
    });

    const bad = await updateMyNotificationPrefs("member", {
      mutedGroups: ["admin_money"],
    });
    expect("error" in bad).toBe(true);
    expect(await prefsRows(a)).toHaveLength(0);

    const ok = await updateMyNotificationPrefs("member", {
      mutedGroups: ["session"],
    });
    expect(ok).toEqual({ success: true });

    const res = await notify(testDb, {
      kind: "session_opened",
      recipients: [
        { type: "member", id: a },
        { type: "member", id: b },
      ],
      payload: { sessionDate: "2026-11-06", startTime: "20:30" },
      dedupBase: "sopen:s1",
    });
    expect(res.inserted).toBe(1);
    const rows = await testDb.select().from(notifications);
    expect(rows.map((r) => r.recipientId)).toEqual([b]);
  });

  it("upserts one row per recipient and keeps the other field on partial patches", async () => {
    const a = await addMember("A");
    userMock.getUserFromCookie.mockResolvedValue({
      memberId: a,
      externalId: "x",
    });
    await updateMyNotificationPrefs("member", { mutedGroups: ["venue"] });
    await updateMyNotificationPrefs("member", { emailEnabled: false });
    const rows = await prefsRows(a);
    expect(rows).toHaveLength(1);
    expect(rows[0].mutedGroups).toEqual(["venue"]);
    expect(rows[0].emailEnabled).toBe(false);
    expect(rows[0].updatedAt).toMatch(/Z$/);
  });

  it("dedupes groups and rejects unknown values and empty patches", async () => {
    const a = await addMember("A");
    userMock.getUserFromCookie.mockResolvedValue({
      memberId: a,
      externalId: "x",
    });
    await updateMyNotificationPrefs("member", {
      mutedGroups: ["session", "session"],
    });
    expect((await prefsRows(a))[0].mutedGroups).toEqual(["session"]);
    // "account" toàn tin bắt buộc: không có công tắc nên server cũng từ chối.
    const mandatory = await updateMyNotificationPrefs("member", {
      mutedGroups: ["account"],
    });
    expect("error" in mandatory).toBe(true);
    const unknown = await updateMyNotificationPrefs("member", {
      // @ts-expect-error nhóm không tồn tại
      mutedGroups: ["nope"],
    });
    expect("error" in unknown).toBe(true);
    const empty = await updateMyNotificationPrefs("member", {});
    expect("error" in empty).toBe(true);
  });

  it("get returns defaults, the member email, and never someone else's prefs", async () => {
    const a = await addMember("A", "a@x.test");
    const b = await addMember("B");
    userMock.getUserFromCookie.mockResolvedValue({
      memberId: b,
      externalId: "x",
    });
    await updateMyNotificationPrefs("member", { mutedGroups: ["session"] });

    userMock.getUserFromCookie.mockResolvedValue({
      memberId: a,
      externalId: "x",
    });
    expect(await getMyNotificationPrefs("member")).toEqual({
      mutedGroups: [],
      emailEnabled: true,
      email: "a@x.test",
      emailVerified: false,
    });
  });

  it("admin scope accepts admin groups only and needs an admin session", async () => {
    expect(
      "error" in
        (await updateMyNotificationPrefs("admin", { mutedGroups: [] })),
    ).toBe(true);
    authMock.requireAdmin.mockResolvedValue({ admin: { sub: "5" } });
    const bad = await updateMyNotificationPrefs("admin", {
      mutedGroups: ["session"],
    });
    expect("error" in bad).toBe(true);
    const ok = await updateMyNotificationPrefs("admin", {
      mutedGroups: ["admin_inventory"],
    });
    expect(ok).toEqual({ success: true });
    const got = await getMyNotificationPrefs("admin");
    expect("error" in got).toBe(false);
    if ("error" in got) return;
    expect(got.mutedGroups).toEqual(["admin_inventory"]);
  });

  it("nothing is readable or writable when logged out", async () => {
    expect("error" in (await getMyNotificationPrefs("member"))).toBe(true);
    expect(
      "error" in
        (await updateMyNotificationPrefs("member", { emailEnabled: false })),
    ).toBe(true);
  });
});

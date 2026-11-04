import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  admins,
  members,
  notificationPrefs,
  notifications,
  sessions,
  votes,
} from "@/db/schema";

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { notify, isNotificationsEnabled } = await import("./notify");
const { runAfterResponse } = await import("./after");
const {
  superadminRecipients,
  sessionVoteRecipients,
  groupMemberRecipients,
  memberName,
} = await import("./recipients");
const { enableNotificationsForTest } = await import("./test-helpers");

async function reset() {
  for (const t of [
    "notifications",
    "notification_prefs",
    "votes",
    "sessions",
    "admins",
    "members",
    "app_settings",
  ]) {
    await client.execute(`DELETE FROM ${t}`);
  }
}

async function addMember(
  name: string,
  opts: {
    isActive?: boolean;
    approvalStatus?: "pending" | "approved" | "rejected";
    nickname?: string;
  } = {},
) {
  const [m] = await testDb
    .insert(members)
    .values({
      name,
      nickname: opts.nickname,
      facebookId: `fb-${name}`,
      isActive: opts.isActive ?? true,
      approvalStatus: opts.approvalStatus ?? "approved",
    })
    .returning({ id: members.id });
  return m.id;
}

const payload = { sessionDate: "2026-11-10", startTime: "20:00" };

describe("notify core", () => {
  beforeEach(reset);

  it("switch off: inserts nothing and reads no notification table", async () => {
    const m = await addMember("A");
    const spy = vi.spyOn(client, "execute");
    const res = await notify(testDb, {
      kind: "session_opened",
      recipients: [{ type: "member", id: m }],
      payload,
      dedupBase: "sopen:s1",
    });
    const sqls = spy.mock.calls.map((c) => {
      const stmt = c[0] as string | { sql: string };
      return typeof stmt === "string" ? stmt : stmt.sql;
    });
    spy.mockRestore();
    expect(res).toEqual({ inserted: 0, ids: [] });
    expect(sqls).toHaveLength(1);
    expect(sqls[0]).toContain("app_settings");
    expect(sqls.join("\n")).not.toMatch(/notification/);
    expect(await testDb.select().from(notifications)).toHaveLength(0);
  });

  it("isNotificationsEnabled reads the setting", async () => {
    expect(await isNotificationsEnabled(testDb)).toBe(false);
    await enableNotificationsForTest(testDb);
    expect(await isNotificationsEnabled(testDb)).toBe(true);
  });

  it("runAfterResponse outside a request scope does not throw", () => {
    expect(() => runAfterResponse(async () => {})).not.toThrow();
  });

  it("inserts one row per recipient with suffixed dedup keys", async () => {
    await enableNotificationsForTest(testDb);
    const a = await addMember("A");
    const b = await addMember("B");
    const now = new Date("2026-11-04T01:02:03.000Z");
    const res = await notify(testDb, {
      kind: "session_opened",
      recipients: [
        { type: "member", id: a },
        { type: "member", id: b },
        { type: "member", id: a },
        { type: "admin", id: a },
      ],
      payload,
      dedupBase: "sopen:s1",
      entity: { type: "session", id: 1 },
      now,
    });
    expect(res.inserted).toBe(3);
    expect(res.ids).toHaveLength(3);
    const rows = await testDb.select().from(notifications);
    expect(rows.map((r) => r.dedupKey).sort()).toEqual(
      [`sopen:s1:a${a}`, `sopen:s1:m${a}`, `sopen:s1:m${b}`].sort(),
    );
    expect(rows[0].createdAt).toBe("2026-11-04T01:02:03.000Z");
    expect(rows[0].entityType).toBe("session");
    expect(rows[0].mandatory).toBe(false);
  });

  it("same dedupBase twice: second call inserts 0", async () => {
    await enableNotificationsForTest(testDb);
    const a = await addMember("A");
    const input = {
      kind: "session_opened" as const,
      recipients: [{ type: "member" as const, id: a }],
      payload,
      dedupBase: "sopen:s1",
    };
    expect((await notify(testDb, input)).inserted).toBe(1);
    expect(await notify(testDb, input)).toEqual({ inserted: 0, ids: [] });
    expect(await testDb.select().from(notifications)).toHaveLength(1);
  });

  it("muted optional group is skipped; mandatory kind ignores mutes", async () => {
    await enableNotificationsForTest(testDb);
    const a = await addMember("A");
    const b = await addMember("B");
    await testDb.insert(notificationPrefs).values({
      recipientType: "member",
      recipientId: a,
      mutedGroups: ["session"],
      updatedAt: "2026-11-04T00:00:00.000Z",
    });
    const recipients = [
      { type: "member" as const, id: a },
      { type: "member" as const, id: b },
    ];
    const optional = await notify(testDb, {
      kind: "session_opened",
      recipients,
      payload,
      dedupBase: "sopen:s1",
    });
    expect(optional.inserted).toBe(1);
    const mandatory = await notify(testDb, {
      kind: "session_cancelled",
      recipients,
      payload,
      dedupBase: "scancel:s1:t",
    });
    expect(mandatory.inserted).toBe(2);
    const rows = await testDb.select().from(notifications);
    expect(rows.filter((r) => r.kind === "session_opened")).toHaveLength(1);
    expect(
      rows
        .filter((r) => r.kind === "session_cancelled")
        .every((r) => r.mandatory),
    ).toBe(true);
  });

  it("rolls back with the caller transaction", async () => {
    await enableNotificationsForTest(testDb);
    const a = await addMember("A");
    await expect(
      testDb.transaction(async (tx) => {
        await notify(tx, {
          kind: "session_opened",
          recipients: [{ type: "member", id: a }],
          payload,
          dedupBase: "sopen:s1",
        });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await testDb.select().from(notifications)).toHaveLength(0);
  });
});

describe("recipient helpers", () => {
  beforeEach(reset);

  it("superadminRecipients returns only role=superadmin admins", async () => {
    const [x] = await testDb
      .insert(admins)
      .values({ username: "root", passwordHash: "x", role: "superadmin" })
      .returning({ id: admins.id });
    // Cột role chỉ có 1 giá trị ở TS; ép giá trị lạ qua SQL để chứng minh bộ lọc.
    await client.execute(
      "INSERT INTO admins (username, password_hash, role) VALUES ('other','x','viewer')",
    );
    expect(await superadminRecipients(testDb)).toEqual([
      { type: "admin", id: x.id },
    ]);
  });

  it("groupMemberRecipients and memberName", async () => {
    const a = await addMember("A", { nickname: "Ace" });
    await addMember("Locked", { isActive: false });
    await addMember("Pend", { approvalStatus: "pending" });
    expect(await groupMemberRecipients(testDb)).toEqual([
      { type: "member", id: a },
    ]);
    expect(await memberName(testDb, a)).toBe("Ace");
  });

  it("sessionVoteRecipients: notVoted includes stale false/false rows and excludes locked or pending members", async () => {
    const [s] = await testDb
      .insert(sessions)
      .values({ date: "2026-11-10", startTime: "20:00", endTime: "22:00" })
      .returning({ id: sessions.id });
    const player = await addMember("Player");
    const diner = await addMember("Diner");
    const stale = await addMember("Stale");
    const none = await addMember("None");
    await addMember("Locked", { isActive: false });
    await addMember("Pend", { approvalStatus: "pending" });
    await testDb.insert(votes).values([
      { sessionId: s.id, memberId: player, willPlay: true, willDine: false },
      { sessionId: s.id, memberId: diner, willPlay: false, willDine: true },
      { sessionId: s.id, memberId: stale, willPlay: false, willDine: false },
    ]);
    const ids = async (w: "voted" | "notVoted" | "play") =>
      (await sessionVoteRecipients(testDb, s.id, w)).map((r) => r.id).sort();
    expect(await ids("notVoted")).toEqual([stale, none].sort());
    expect(await ids("voted")).toEqual([player, diner].sort());
    expect(await ids("play")).toEqual([player]);
  });
});

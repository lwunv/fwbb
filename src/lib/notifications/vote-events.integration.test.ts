/**
 * Tin quanh vote (Task 7): ngưỡng sân cho admin, "sắp đầy" cho người chưa vote,
 * bỏ chơi sát giờ, admin sửa vote. Ghim TZ=UTC như server Vercel để mọi mốc
 * giờ phải đi qua +07:00.
 */
process.env.TZ = "UTC";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { admins, members, notifications, sessions, votes } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { nowDeadlineVN } from "@/lib/vote-deadline";

const userMock = vi.hoisted(() => ({
  getUserFromCookie:
    vi.fn<() => Promise<{ memberId: number; externalId: string } | null>>(),
}));
vi.mock("@/lib/user-identity", () => userMock);
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
  getAdminFromCookie: vi.fn(async () => ({ sub: "1", role: "admin" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/messenger", () => ({
  sendGroupMessage: vi.fn(),
  buildDebtReminderMessage: vi.fn(),
  buildNewSessionMessage: vi.fn(),
  buildConfirmedMessage: vi.fn(),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const {
  submitVote,
  adminSetVote,
  adminSetGuestCount,
  adminRemoveVote,
  adminSetPartner,
} = await import("@/actions/votes");
const { setSessionMaxPlayers, setAdminGuestCount } =
  await import("@/actions/sessions");
const { enableNotificationsForTest } = await import("./test-helpers");

const HOUR = 3_600_000;

afterAll(() => {
  delete process.env.TZ;
});

async function reset() {
  for (const t of [
    "rate_limit_buckets",
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
  userMock.getUserFromCookie.mockReset();
}

let seq = 0;
async function addMember(
  opts: {
    isActive?: boolean;
    approvalStatus?: "pending" | "approved" | "rejected";
  } = {},
) {
  seq++;
  const [m] = await testDb
    .insert(members)
    .values({
      name: `M${seq}`,
      facebookId: `fb-${seq}`,
      isActive: opts.isActive ?? true,
      approvalStatus: opts.approvalStatus ?? "approved",
    })
    .returning({ id: members.id });
  return m.id;
}

async function addMembers(n: number) {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(await addMember());
  return out;
}

async function addSuperadmin() {
  seq++;
  const [a] = await testDb
    .insert(admins)
    .values({ username: `admin${seq}`, passwordHash: "hash" })
    .returning({ id: admins.id });
  return a.id;
}

async function addSession(
  values: Partial<typeof sessions.$inferInsert> & { date: string },
) {
  const [s] = await testDb
    .insert(sessions)
    .values({ status: "voting", voteDeadline: null, ...values })
    .returning({ id: sessions.id });
  return s.id;
}

async function seedPlayVotes(sessionId: number, memberIds: number[]) {
  for (const memberId of memberIds) {
    await testDb
      .insert(votes)
      .values({ sessionId, memberId, willPlay: true, willDine: false });
  }
}

async function voteAs(
  memberId: number,
  sessionId: number,
  willPlay: boolean,
  willDine = false,
) {
  userMock.getUserFromCookie.mockResolvedValue({
    memberId,
    externalId: `fb-${memberId}`,
  });
  return submitVote(sessionId, willPlay, willDine, 0, 0, false);
}

async function rows(kind: string) {
  const all = await testDb
    .select({
      recipientType: notifications.recipientType,
      recipientId: notifications.recipientId,
      kind: notifications.kind,
      payload: notifications.payload,
      dedupKey: notifications.dedupKey,
    })
    .from(notifications)
    .orderBy(notifications.id);
  return all.filter((r) => r.kind === kind);
}

const ranks = async () =>
  (await rows("capacity_alert")).map((r) => [
    (r.payload as { rank: number }).rank,
    (r.payload as { headcount: number }).headcount,
    (r.payload as { maxPlayers: number }).maxPlayers,
  ]);

/** Ngày + giờ VN của mốc `ms`, để dựng buổi bắt đầu đúng N giờ sau bây giờ. */
function vnDateTime(ms: number) {
  const s = nowDeadlineVN(new Date(ms));
  return { date: s.slice(0, 10), startTime: s.slice(11, 16) };
}

beforeEach(reset);

describe("capacity alerts for admins", () => {
  it('votes 13→14→15: one "almost full" alert; →16: one "full"; →17: one "over"; drop to 14 then back to 16: no new alert', async () => {
    await enableNotificationsForTest(testDb);
    const admin = await addSuperadmin();
    const people = await addMembers(17);
    const sid = await addSession({
      date: "2026-12-20",
      startTime: "20:30",
      maxPlayers: 16,
    });
    await seedPlayVotes(sid, people.slice(0, 12));

    expect(await voteAs(people[12], sid, true)).toEqual({ success: true }); // 13
    expect(await ranks()).toEqual([]);
    await voteAs(people[13], sid, true); // 14
    await voteAs(people[14], sid, true); // 15
    expect(await ranks()).toEqual([[1, 14, 16]]);
    await voteAs(people[15], sid, true); // 16
    expect(await ranks()).toEqual([
      [1, 14, 16],
      [2, 16, 16],
    ]);
    // Member không tự vote vượt sức chứa được; admin thì được.
    await adminSetVote(sid, people[16], true, false); // 17
    expect(await ranks()).toEqual([
      [1, 14, 16],
      [2, 16, 16],
      [3, 17, 16],
    ]);

    await voteAs(people[0], sid, false); // 16
    await adminRemoveVote(sid, people[1]); // 15
    await adminSetVote(sid, people[2], false, false); // 14
    await voteAs(people[0], sid, true); // 15
    await adminSetVote(sid, people[1], true, false); // 16
    expect(await ranks()).toHaveLength(3);

    const cap = await rows("capacity_alert");
    expect(cap.every((r) => r.recipientType === "admin")).toBe(true);
    expect(cap.every((r) => r.recipientId === admin)).toBe(true);
    expect(cap.map((r) => r.dedupKey)).toEqual([
      `cap:s${sid}:x16:r1:a${admin}`,
      `cap:s${sid}:x16:r2:a${admin}`,
      `cap:s${sid}:x16:r3:a${admin}`,
    ]);
    const p = cap[0].payload as Record<string, unknown>;
    expect(p).toMatchObject({
      sessionDate: "2026-12-20",
      startTime: "20:30",
      courtLockAt: "2026-12-19T13:30:00.000Z",
    });
  });

  it("raising maxPlayers to 20 resets alerts for the new capacity", async () => {
    await enableNotificationsForTest(testDb);
    await addSuperadmin();
    const people = await addMembers(20);
    const sid = await addSession({ date: "2026-12-21", maxPlayers: 16 });
    await seedPlayVotes(sid, people.slice(0, 15));
    await voteAs(people[15], sid, true); // 16/16
    expect(await ranks()).toEqual([[2, 16, 16]]);

    expect(await setSessionMaxPlayers(sid, 20)).toEqual({ success: true });
    expect(await ranks()).toHaveLength(1); // 16/20: chưa tới ngưỡng
    await voteAs(people[16], sid, true); // 17/20
    await voteAs(people[17], sid, true); // 18/20
    await voteAs(people[18], sid, true); // 19/20
    await voteAs(people[19], sid, true); // 20/20
    expect(await ranks()).toEqual([
      [2, 16, 16],
      [1, 18, 20],
      [2, 20, 20],
    ]);
  });

  it("admin guests count toward the headcount and trigger the alert", async () => {
    await enableNotificationsForTest(testDb);
    await addSuperadmin();
    const people = await addMembers(13);
    const sid = await addSession({ date: "2026-12-22", maxPlayers: 16 });
    await seedPlayVotes(sid, people);
    expect(await setAdminGuestCount(sid, 3, 0)).toEqual({ success: true });
    expect(await ranks()).toEqual([[2, 16, 16]]);
  });
});

describe("almost full for members", () => {
  it('members who have not voted get one "almost full" when 2 slots remain; nothing once full', async () => {
    await enableNotificationsForTest(testDb);
    const people = await addMembers(16);
    const notVoted = await addMembers(2);
    await addMember({ isActive: false });
    await addMember({ approvalStatus: "pending" });
    const sid = await addSession({ date: "2026-12-23", maxPlayers: 16 });
    await seedPlayVotes(sid, people.slice(0, 13));

    await voteAs(people[13], sid, true); // 14: còn 2 chỗ
    await voteAs(people[14], sid, true); // 15: còn 1 chỗ, không gửi lại
    let almost = await rows("session_almost_full");
    // Người chưa vote lúc còn 2 chỗ: people[14], people[15] và 2 người kia.
    expect(almost.map((r) => r.recipientId).sort((a, b) => a - b)).toEqual([
      people[14],
      people[15],
      ...notVoted,
    ]);
    expect(almost.every((r) => r.recipientType === "member")).toBe(true);
    expect(almost[0].payload).toEqual({
      sessionDate: "2026-12-23",
      startTime: "20:30",
    });

    await voteAs(people[15], sid, true); // 16: đầy
    almost = await rows("session_almost_full");
    expect(almost).toHaveLength(4);

    // Nhảy thẳng từ 13 lên đầy: không ai nhận "sắp đầy".
    const sid2 = await addSession({ date: "2026-12-24", maxPlayers: 16 });
    await seedPlayVotes(sid2, people.slice(0, 13));
    await setAdminGuestCount(sid2, 3, 0);
    const second = (await rows("session_almost_full")).filter((r) =>
      r.dedupKey.startsWith(`salmost:s${sid2}:`),
    );
    expect(second).toEqual([]);
  });

  it("vote closed: no almost-full alert for members", async () => {
    await enableNotificationsForTest(testDb);
    const people = await addMembers(15);
    const sid = await addSession({
      date: "2026-12-25",
      maxPlayers: 16,
      voteDeadline: "2026-01-01T00:00:00",
    });
    await seedPlayVotes(sid, people.slice(0, 13));
    await adminSetVote(sid, people[13], true, false); // 14
    expect(await rows("session_almost_full")).toEqual([]);
  });
});

describe("late dropout", () => {
  it("dropout 10h before start notifies superadmins; dropout 3 days before does not", async () => {
    await enableNotificationsForTest(testDb);
    const admin = await addSuperadmin();
    const [a, b, c] = await addMembers(3);
    const soon = vnDateTime(Date.now() + 10 * HOUR);
    const sid = await addSession({ ...soon, maxPlayers: 16 });
    await seedPlayVotes(sid, [a, b, c]);

    expect(await voteAs(a, sid, false, true)).toEqual({ success: true });
    const drops = await rows("member_dropped_late");
    expect(drops).toHaveLength(1);
    expect(drops[0].recipientType).toBe("admin");
    expect(drops[0].recipientId).toBe(admin);
    expect(drops[0].dedupKey).toMatch(
      new RegExp(`^drop:s${sid}:m${a}:.+:a${admin}$`),
    );
    expect(drops[0].payload).toEqual({
      sessionDate: soon.date,
      startTime: soon.startTime,
      memberName: (await testDb.query.members.findFirst({
        where: eq(members.id, a),
      }))!.name,
      headcount: 2,
      maxPlayers: 16,
    });

    // Vote lại chơi rồi giữ nguyên: không phải bỏ chơi.
    await voteAs(b, sid, true);
    expect(await rows("member_dropped_late")).toHaveLength(1);

    const later = vnDateTime(Date.now() + 72 * HOUR);
    const sid2 = await addSession({ ...later, maxPlayers: 16 });
    await seedPlayVotes(sid2, [a, b]);
    await voteAs(a, sid2, false);
    expect(await rows("member_dropped_late")).toHaveLength(1);
  });
});

describe("vote edited by admin", () => {
  it("adminSetGuestCount notifies the member with their own new guest count only", async () => {
    await enableNotificationsForTest(testDb);
    const [a, b] = await addMembers(2);
    const sid = await addSession({ date: "2026-12-26", maxPlayers: 16 });
    await seedPlayVotes(sid, [a, b]);

    expect(await adminSetGuestCount(sid, a, 2, 1)).toEqual({ success: true });
    const edits = await rows("vote_edited_by_admin");
    expect(edits).toHaveLength(1);
    expect(edits[0].recipientType).toBe("member");
    expect(edits[0].recipientId).toBe(a);
    expect(edits[0].dedupKey).toMatch(
      new RegExp(`^vedit:s${sid}:m${a}:.+:m${a}$`),
    );
    expect(edits[0].payload).toEqual({
      sessionDate: "2026-12-26",
      startTime: "20:30",
      willPlay: true,
      willDine: false,
      withPartner: false,
      guestPlayCount: 2,
      guestDineCount: 1,
    });
  });

  it("adminSetVote, adminSetPartner and adminRemoveVote each notify the member; removal sends all false", async () => {
    await enableNotificationsForTest(testDb);
    const [a] = await addMembers(1);
    const sid = await addSession({ date: "2026-12-27", maxPlayers: 16 });

    await adminSetVote(sid, a, true, true);
    await adminSetPartner(sid, a, true);
    await adminRemoveVote(sid, a);
    const edits = (await rows("vote_edited_by_admin")).map((r) => r.payload);
    const when = { sessionDate: "2026-12-27", startTime: "20:30" };
    expect(edits).toEqual([
      {
        ...when,
        willPlay: true,
        willDine: true,
        withPartner: false,
        guestPlayCount: 0,
        guestDineCount: 0,
      },
      {
        ...when,
        willPlay: true,
        willDine: true,
        withPartner: true,
        guestPlayCount: 0,
        guestDineCount: 0,
      },
      {
        ...when,
        willPlay: false,
        willDine: false,
        withPartner: false,
        guestPlayCount: 0,
        guestDineCount: 0,
      },
    ]);
  });
});

describe("switch off", () => {
  /** Ghi lại SQL của cả kết nối chính lẫn kết nối transaction. */
  function spySql() {
    const sqls: string[] = [];
    const text = (stmt: unknown) =>
      typeof stmt === "string" ? stmt : (stmt as { sql: string }).sql;
    const exec = vi.spyOn(client, "execute");
    const realTransaction = client.transaction.bind(client);
    const txSpy = vi.spyOn(client, "transaction").mockImplementation((async (
      ...args: Parameters<typeof realTransaction>
    ) => {
      const tx = await realTransaction(...args);
      const realTxExecute = tx.execute.bind(tx);
      tx.execute = ((stmt: never) => {
        sqls.push(text(stmt));
        return realTxExecute(stmt);
      }) as typeof tx.execute;
      return tx;
    }) as typeof client.transaction);
    return {
      sqls,
      restore() {
        for (const c of exec.mock.calls) sqls.push(text(c[0]));
        exec.mockRestore();
        txSpy.mockRestore();
      },
    };
  }

  it("control: with the switch on, the same spy sees the notification and admin queries inside the transaction", async () => {
    await enableNotificationsForTest(testDb);
    await addSuperadmin();
    const people = await addMembers(15);
    const sid = await addSession({ date: "2026-12-28", maxPlayers: 16 });
    await seedPlayVotes(sid, people.slice(0, 14));
    const spy = spySql();
    try {
      await voteAs(people[14], sid, true);
    } finally {
      spy.restore();
    }
    const all = spy.sqls.join("\n");
    expect(all).toMatch(/"notifications"/);
    expect(all).toMatch(/"admins"/);
  });

  it("switch off: submitVote runs no query on notifications/notification_prefs/admins and returns exactly as before", async () => {
    await addSuperadmin();
    const people = await addMembers(15);
    const soon = vnDateTime(Date.now() + 10 * HOUR);
    const sid = await addSession({ ...soon, maxPlayers: 16 });
    await seedPlayVotes(sid, people.slice(0, 14));

    const spy = spySql();
    let first: unknown;
    let second: unknown;
    try {
      first = await voteAs(people[14], sid, true); // 15: ngưỡng sắp đầy
      second = await voteAs(people[0], sid, false); // bỏ chơi sát giờ
    } finally {
      spy.restore();
    }
    expect(first).toEqual({ success: true });
    expect(second).toEqual({ success: true });
    expect(spy.sqls.length).toBeGreaterThan(0);
    const all = spy.sqls.join("\n");
    expect(all).not.toMatch(/notification/);
    expect(all).not.toMatch(/"admins"/);
    expect(await testDb.select().from(notifications)).toHaveLength(0);
    expect(
      await testDb.query.votes.findFirst({
        where: and(eq(votes.sessionId, sid), eq(votes.memberId, people[0])),
      }),
    ).toBeUndefined();
    expect(
      (
        await testDb.query.votes.findFirst({
          where: and(eq(votes.sessionId, sid), eq(votes.memberId, people[14])),
        })
      )?.willPlay,
    ).toBe(true);
  });
});

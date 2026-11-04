process.env.TZ = "UTC";

import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import {
  admins,
  appSettings,
  courts,
  members,
  notifications,
  scheduledJobs,
  sessions,
  votes,
} from "@/db/schema";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

vi.mock("./qstash", () => ({
  QSTASH_MAX_DELAY_MS: 7 * 24 * 3_600_000,
  publishJob: vi.fn(async () => ({ messageId: "m" })),
  cancelJobMessage: vi.fn(async () => {}),
}));

const { rescheduleSessionJobs, runJob } = await import("./jobs");
const { enableNotificationsForTest } = await import("./test-helpers");

// 2026-11-05 09:00 VN.
const NOW = new Date("2026-11-05T09:00:00+07:00");
let seq = 0;

async function reset() {
  for (const t of [
    "scheduled_jobs",
    "notification_deliveries",
    "notifications",
    "notification_prefs",
    "votes",
    "sessions",
    "courts",
    "admins",
    "members",
    "app_settings",
  ]) {
    await client.execute(`DELETE FROM ${t}`);
  }
}

async function addMember(name: string) {
  seq++;
  const [m] = await testDb
    .insert(members)
    .values({
      name,
      facebookId: `fb-${seq}`,
      isActive: true,
      approvalStatus: "approved",
    })
    .returning({ id: members.id });
  return m.id;
}

async function addAdmin() {
  seq++;
  await testDb
    .insert(admins)
    .values({ username: `sa${seq}`, passwordHash: "x", role: "superadmin" });
}

async function addSession(
  opts: { courtId?: number; maxPlayers?: number; date?: string } = {},
) {
  const [s] = await testDb
    .insert(sessions)
    .values({
      date: opts.date ?? "2026-11-07",
      status: "voting",
      startTime: "20:30",
      voteDeadline: `${opts.date ?? "2026-11-07"}T16:30:00`,
      courtId: opts.courtId,
      maxPlayers: opts.maxPlayers ?? 16,
    })
    .returning({ id: sessions.id });
  await rescheduleSessionJobs(testDb, s.id, NOW);
  return s.id;
}

async function jobOf(sid: number, kind: string) {
  const rows = await testDb
    .select()
    .from(scheduledJobs)
    .where(eq(scheduledJobs.sessionId, sid));
  const row = rows.find((r) => r.kind === kind && r.status === "scheduled");
  if (!row) throw new Error(`no ${kind} job`);
  return row;
}

/** Chạy job đúng mốc runAt của nó. */
async function runAtDue(sid: number, kind: string) {
  const job = await jobOf(sid, kind);
  return runJob(testDb, job, new Date(job.runAt));
}

async function notifs(kind: string) {
  return testDb
    .select()
    .from(notifications)
    .where(eq(notifications.kind, kind as never));
}

async function vote(memberId: number, sid: number, willPlay: boolean) {
  await testDb
    .insert(votes)
    .values({ sessionId: sid, memberId, willPlay, willDine: false });
}

describe("scheduled session reminders", () => {
  beforeEach(async () => {
    await reset();
    await enableNotificationsForTest(testDb);
  });

  it("vote_due_2h notifies non-voters and gives admins the unvoted names", async () => {
    await addAdmin();
    const a = await addMember("An");
    const b = await addMember("Binh");
    const sid = await addSession();
    await vote(a, sid, true);

    expect(await runAtDue(sid, "vote_due_2h")).toBe("done");

    const soon = await notifs("vote_due_soon");
    expect(soon).toHaveLength(1);
    expect(soon[0].recipientId).toBe(b);
    expect(soon[0].payload).toMatchObject({ hoursLeft: 2 });
    const unvoted = await notifs("unvoted_before_deadline");
    expect(unvoted).toHaveLength(1);
    expect(unvoted[0].recipientType).toBe("admin");
    expect(unvoted[0].payload).toMatchObject({
      names: ["Binh"],
      voteDeadline: "2026-11-07T16:30:00",
      sessionDate: "2026-11-07",
      startTime: "20:30",
    });
  });

  it("vote_due_24h notifies non-voters only", async () => {
    await addAdmin();
    const a = await addMember("An");
    const sid = await addSession();
    expect(await runAtDue(sid, "vote_due_24h")).toBe("done");
    const soon = await notifs("vote_due_soon");
    expect(soon.map((n) => n.recipientId)).toEqual([a]);
    expect(soon[0].payload).toMatchObject({ hoursLeft: 24 });
    expect(await notifs("unvoted_before_deadline")).toHaveLength(0);
  });

  it("vote_due_24h run late by the daily sweep reports the real hours left, not 24", async () => {
    await addAdmin();
    const a = await addMember("An");
    const sid = await addSession();
    const job = await jobOf(sid, "vote_due_24h");
    // Hạn 16:30 ngày 7/11; lượt quét 06:30 cùng ngày còn 10 giờ.
    const sweep = new Date("2026-11-07T06:30:00+07:00");
    expect(await runJob(testDb, job, sweep)).toBe("done");
    const soon = await notifs("vote_due_soon");
    expect(soon.map((n) => n.recipientId)).toEqual([a]);
    expect(soon[0].payload).toMatchObject({ hoursLeft: 10 });
    // Khoá chống lặp vẫn theo mốc của job, không theo số giờ còn lại.
    expect(soon[0].dedupKey).toMatch(new RegExp(`^vdue:s${sid}:24h:`));
  });

  it("vote_due reminders delivered a little late keep the nominal hours; under one hour left says 1", async () => {
    await addAdmin();
    await addMember("An");
    const sid = await addSession();
    const day = await jobOf(sid, "vote_due_24h");
    const two = await jobOf(sid, "vote_due_2h");
    const late = (iso: string, ms: number) =>
      new Date(new Date(iso).getTime() + ms);
    // QStash giao trễ vài chục giây: vẫn là 24 giờ.
    await runJob(testDb, day, late(day.runAt, 40_000));
    // Job 2 giờ chạy lúc còn 20 phút: tối thiểu 1 giờ.
    await runJob(testDb, two, late(two.runAt, 100 * 60_000));
    const soon = await notifs("vote_due_soon");
    expect(
      soon
        .map((n) => (n.payload as { hoursLeft: number }).hoursLeft)
        .sort((x, y) => x - y),
    ).toEqual([1, 24]);
  });

  it("vote_due_2h after admin moved the deadline is skipped", async () => {
    await addAdmin();
    await addMember("An");
    const sid = await addSession();
    const job = await jobOf(sid, "vote_due_2h");
    await testDb
      .update(sessions)
      .set({ voteDeadline: "2026-11-07T18:00:00" })
      .where(eq(sessions.id, sid));
    expect(await runJob(testDb, job, new Date(job.runAt))).toBe("skipped");
    expect(await notifs("vote_due_soon")).toHaveLength(0);
    expect(await notifs("unvoted_before_deadline")).toHaveLength(0);
  });

  it("vote_due_2h with everyone voted sends no admin unvoted list", async () => {
    await addAdmin();
    const a = await addMember("An");
    const sid = await addSession();
    // Chỉ ăn (không chơi) vẫn là đã vote.
    await testDb
      .insert(votes)
      .values({ sessionId: sid, memberId: a, willPlay: false, willDine: true });
    expect(await runAtDue(sid, "vote_due_2h")).toBe("done");
    expect(await notifs("vote_due_soon")).toHaveLength(0);
    expect(await notifs("unvoted_before_deadline")).toHaveLength(0);
  });

  it("court_lock with 7/16 players alerts admins; with 8/16 does not", async () => {
    await addAdmin();
    const ids: number[] = [];
    for (let i = 0; i < 8; i++) ids.push(await addMember(`P${i}`));
    const low = await addSession();
    for (const id of ids.slice(0, 7)) await vote(id, low, true);
    expect(await runAtDue(low, "court_lock")).toBe("done");
    const alerts = await notifs("low_attendance");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].payload).toMatchObject({
      headcount: 7,
      maxPlayers: 16,
      sessionDate: "2026-11-07",
      startTime: "20:30",
    });

    const ok = await addSession({ date: "2026-11-08" });
    for (const id of ids) await vote(id, ok, true);
    expect(await runAtDue(ok, "court_lock")).toBe("done");
    expect(await notifs("low_attendance")).toHaveLength(1);
  });

  it("old court_lock job after courtLockHoursBefore changed is skipped", async () => {
    await addAdmin();
    const sid = await addSession();
    const job = await jobOf(sid, "court_lock");
    await testDb
      .insert(appSettings)
      .values({ key: "courtLockHoursBefore", value: "9" })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: "9" } });
    expect(await runJob(testDb, job, new Date(job.runAt))).toBe("skipped");
    expect(await notifs("low_attendance")).toHaveLength(0);
  });

  it("day_3h sends game_day_reminder with court name and map link to players", async () => {
    const [court] = await testDb
      .insert(courts)
      .values({
        name: "San A",
        pricePerSession: 1,
        mapLink: "https://maps.test/a",
      })
      .returning({ id: courts.id });
    const p = await addMember("Play");
    const n = await addMember("NoPlay");
    const sid = await addSession({ courtId: court.id });
    await vote(p, sid, true);
    await vote(n, sid, false);
    expect(await runAtDue(sid, "day_3h")).toBe("done");
    const rows = await notifs("game_day_reminder");
    expect(rows.map((r) => r.recipientId)).toEqual([p]);
    expect(rows[0].payload).toMatchObject({
      when: "3h",
      courtName: "San A",
      mapLink: "https://maps.test/a",
    });
  });

  it("day_morning without a court still sends", async () => {
    const p = await addMember("Play");
    const sid = await addSession();
    await vote(p, sid, true);
    expect(await runAtDue(sid, "day_morning")).toBe("done");
    const rows = await notifs("game_day_reminder");
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({ when: "morning" });
  });

  it("day_3h for a cancelled session sends nothing", async () => {
    const p = await addMember("Play");
    const sid = await addSession();
    await vote(p, sid, true);
    const job = await jobOf(sid, "day_3h");
    await testDb
      .update(sessions)
      .set({ status: "cancelled" })
      .where(eq(sessions.id, sid));
    expect(await runJob(testDb, job, new Date(job.runAt))).toBe("skipped");
    expect(await notifs("game_day_reminder")).toHaveLength(0);
  });

  it("confirmSession after scheduling: day_3h still sends", async () => {
    const p = await addMember("Play");
    const sid = await addSession();
    await vote(p, sid, true);
    const job = await jobOf(sid, "day_3h");
    await testDb
      .update(sessions)
      .set({ status: "confirmed" })
      .where(eq(sessions.id, sid));
    expect(await runJob(testDb, job, new Date(job.runAt))).toBe("done");
    expect(await notifs("game_day_reminder")).toHaveLength(1);
  });

  it("a job run after the session start is skipped", async () => {
    const p = await addMember("Play");
    const sid = await addSession();
    await vote(p, sid, true);
    const job = await jobOf(sid, "day_3h");
    expect(
      await runJob(testDb, job, new Date("2026-11-07T20:31:00+07:00")),
    ).toBe("skipped");
  });

  it("running the same job twice creates no duplicate notifications", async () => {
    await addAdmin();
    await addMember("An");
    const p = await addMember("Play");
    const sid = await addSession();
    await vote(p, sid, true);
    for (const kind of ["vote_due_2h", "court_lock", "day_3h"]) {
      await runAtDue(sid, kind);
      const before = (await testDb.select().from(notifications)).length;
      await runAtDue(sid, kind);
      expect((await testDb.select().from(notifications)).length).toBe(before);
    }
  });

  it("with the switch off a due job sends nothing", async () => {
    const p = await addMember("Play");
    const sid = await addSession();
    await vote(p, sid, true);
    const job = await jobOf(sid, "day_3h");
    await testDb.delete(appSettings);
    expect(await runJob(testDb, job, new Date(job.runAt))).toBe("skipped");
    expect(await notifs("game_day_reminder")).toHaveLength(0);
  });
});

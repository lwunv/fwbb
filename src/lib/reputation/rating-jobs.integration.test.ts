process.env.TZ = "UTC";

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import {
  appSettings,
  exchangeEvents,
  exchangeRegistrations,
  hostFeedback,
  members,
  notificationDeliveries,
  notificationPrefs,
  notifications,
  scheduledJobs,
  venues,
} from "@/db/schema";
import type { MailMessage, MailOutcome } from "@/lib/mailer";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const mailer = vi.hoisted(() => ({
  sendMail: vi.fn<(msg: MailMessage) => Promise<MailOutcome>>(),
}));
vi.mock("@/lib/mailer", () => mailer);

// QStash giả: mặc định "chưa cấu hình"; test bật bằng qstash.state.configured.
const qstash = vi.hoisted(() => {
  let n = 0;
  const state = { configured: false };
  return {
    state,
    QSTASH_MAX_DELAY_MS: 7 * 24 * 3_600_000,
    getQstashConfig: vi.fn(() =>
      state.configured
        ? { token: "t", currentSigningKey: "c", nextSigningKey: "n" }
        : null,
    ),
    publishJob: vi.fn<
      (job: {
        jobKey: string;
        runAt: Date;
        revision?: number;
      }) => Promise<{ messageId: string } | null>
    >(async () => (state.configured ? { messageId: `msg-${++n}` } : null)),
    cancelJobMessage: vi.fn<(id: string) => Promise<void>>(async () => {}),
  };
});
vi.mock("@/lib/notifications/qstash", () => qstash);

const pending = vi.hoisted(() => [] as (() => Promise<unknown>)[]);
vi.mock("@/lib/notifications/after", () => ({
  runAfterResponse: (fn: () => Promise<unknown>) => {
    pending.push(fn);
  },
}));

const {
  ratingJobKey,
  scheduleRatingReminder,
  scheduleRatingReminderAfterCommit,
  runRatingReminder,
} = await import("./rating-jobs");
const { runJob, finishJob } = await import("@/lib/notifications/jobs");
const { runDailyNotifications } = await import("@/lib/notifications/daily");
const { drainOutbox } = await import("@/lib/notifications/outbox");
const { enableNotificationsForTest } =
  await import("@/lib/notifications/test-helpers");

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const KIND = "exchange_rate_reminder";
const fp = (endAt: string) =>
  createHash("sha256").update(endAt).digest("hex").slice(0, 8);

const [venue] = await testDb
  .insert(venues)
  .values({ name: "V", lat: 10, lng: 106, status: "approved" })
  .returning({ id: venues.id });

let seq = 0;
async function addMember(
  over: Partial<typeof members.$inferInsert> = {},
): Promise<number> {
  seq++;
  const [m] = await testDb
    .insert(members)
    .values({ name: `M${seq}`, approvalStatus: "approved", ...over })
    .returning({ id: members.id });
  return m.id;
}

async function addEvent(
  endAt: string,
  over: Partial<typeof exchangeEvents.$inferInsert> = {},
) {
  seq++;
  const host = await addMember();
  const start = new Date(Date.parse(endAt) - 2 * HOUR).toISOString();
  const [ev] = await testDb
    .insert(exchangeEvents)
    .values({
      publicCode: `rj${String(seq).padStart(8, "0")}`,
      hostMemberId: host,
      venueId: venue.id,
      title: "Giao lưu tối",
      startAt: start,
      endAt,
      slotsTotal: 10,
      feeMode: "fixed",
      registerDeadline: start,
      cancelDeadline: start,
      status: "open",
      createdAt: start,
      updatedAt: start,
      ...over,
    })
    .returning();
  return ev;
}

async function addReg(
  eventId: number,
  memberId: number,
  over: Partial<typeof exchangeRegistrations.$inferInsert> = {},
) {
  await testDb.insert(exchangeRegistrations).values({
    eventId,
    memberId,
    status: "approved",
    maleCount: 1,
    checkedIn: true,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...over,
  });
}

async function rated(eventId: number, memberId: number) {
  await testDb.insert(hostFeedback).values({
    eventId,
    fromMemberId: memberId,
    asDescribed: true,
    feeAsPromised: true,
    raterWeight: 1,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
  });
}

const ratingJobs = () =>
  testDb.select().from(scheduledJobs).where(eq(scheduledJobs.kind, KIND));
const reminders = () =>
  testDb.select().from(notifications).where(eq(notifications.kind, KIND));
const snapshot = (ev: typeof exchangeEvents.$inferSelect) => ({
  id: ev.id,
  endAt: ev.endAt,
  status: ev.status,
  hiddenAt: ev.hiddenAt,
});

async function setExchangeFlag(on: boolean) {
  await testDb
    .insert(appSettings)
    .values({ key: "exchangeEnabled", value: String(on) })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: String(on) },
    });
}

async function flush() {
  while (pending.length > 0) await pending.shift()!();
}

beforeEach(async () => {
  for (const t of [
    "scheduled_jobs",
    "notification_deliveries",
    "notifications",
    "notification_prefs",
    "host_feedback",
    "exchange_registrations",
    "exchange_events",
    "app_settings",
  ]) {
    await client.execute(`DELETE FROM ${t}`);
  }
  await enableNotificationsForTest(testDb);
  await setExchangeFlag(true);
  mailer.sendMail.mockReset();
  mailer.sendMail.mockResolvedValue({ ok: true });
  qstash.state.configured = false;
  qstash.publishJob.mockClear();
  qstash.cancelJobMessage.mockClear();
  pending.length = 0;
});

// Buổi kết thúc 2026-11-12 14:00Z; nhắc lúc 15:00Z.
const END = "2026-11-12T14:00:00.000Z";
const RUN_AT = "2026-11-12T15:00:00.000Z";
const BEFORE = new Date("2026-11-10T03:00:00.000Z");
const AT_RUN = new Date(RUN_AT);

describe("ratingJobKey", () => {
  it("is xrate:{eventId}:{first 8 hex of sha256(endAt)}", () => {
    expect(ratingJobKey(42, END)).toBe(`xrate:42:${fp(END)}`);
    expect(ratingJobKey(42, END)).not.toBe(
      ratingJobKey(42, "2026-11-12T14:30:00.000Z"),
    );
  });
});

describe("scheduleRatingReminder", () => {
  it("creating an event schedules one reminder at endAt plus 1 hour with the fingerprint", async () => {
    qstash.state.configured = true;
    const ev = await addEvent(END);
    await scheduleRatingReminder(testDb, snapshot(ev), BEFORE);
    await scheduleRatingReminder(testDb, snapshot(ev), BEFORE);
    const rows = await ratingJobs();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      jobKey: `xrate:${ev.id}:${fp(END)}`,
      runAt: RUN_AT,
      status: "scheduled",
      sessionId: null,
      payload: { eventId: ev.id, endAt: END },
    });
    expect(rows[0].messageId).toMatch(/^msg-/);
    expect(qstash.publishJob).toHaveBeenCalledTimes(1);
    expect(qstash.publishJob).toHaveBeenCalledWith({
      jobKey: rows[0].jobKey,
      runAt: new Date(RUN_AT),
    });
  });

  it("without QStash the row is only stored, never run early", async () => {
    const ev = await addEvent(END);
    const player = await addMember();
    await addReg(ev.id, player);
    await scheduleRatingReminder(testDb, snapshot(ev), BEFORE);
    const rows = await ratingJobs();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "scheduled", messageId: null });
    expect(await reminders()).toHaveLength(0);
  });

  it("host cancel, admin cancel and admin hide cancel the job; unhiding before the reminder revives it", async () => {
    qstash.state.configured = true;
    const ev = await addEvent(END);
    await scheduleRatingReminder(testDb, snapshot(ev), BEFORE);
    const [first] = await ratingJobs();

    // Ẩn: job thành cancelled và message QStash bị huỷ.
    await scheduleRatingReminder(
      testDb,
      { ...snapshot(ev), hiddenAt: BEFORE.toISOString() },
      BEFORE,
    );
    let [row] = await ratingJobs();
    expect(row.status).toBe("cancelled");
    expect(qstash.cancelJobMessage).toHaveBeenCalledWith(first.messageId);

    // Bỏ ẩn trước giờ nhắc: sống lại, đăng lại với revision mới.
    await scheduleRatingReminder(testDb, snapshot(ev), BEFORE);
    [row] = await ratingJobs();
    expect(row).toMatchObject({ status: "scheduled", jobKey: first.jobKey });
    expect(row.payload).toMatchObject({ revision: 1 });
    expect(row.messageId).toMatch(/^msg-/);
    expect(row.messageId).not.toBe(first.messageId);
    expect(qstash.publishJob).toHaveBeenLastCalledWith({
      jobKey: first.jobKey,
      runAt: new Date(RUN_AT),
      revision: 1,
    });

    // Huỷ (host hay admin đều về status cancelled).
    await scheduleRatingReminder(
      testDb,
      { ...snapshot(ev), status: "cancelled" },
      BEFORE,
    );
    [row] = await ratingJobs();
    expect(row.status).toBe("cancelled");
    expect(await ratingJobs()).toHaveLength(1);
  });

  it("unhiding after the reminder time does not revive it", async () => {
    const ev = await addEvent(END);
    await scheduleRatingReminder(testDb, snapshot(ev), BEFORE);
    await scheduleRatingReminder(
      testDb,
      { ...snapshot(ev), hiddenAt: BEFORE.toISOString() },
      BEFORE,
    );
    await scheduleRatingReminder(
      testDb,
      snapshot(ev),
      new Date(AT_RUN.getTime() + 1),
    );
    const [row] = await ratingJobs();
    expect(row.status).toBe("cancelled");
  });

  it("notifications off at creation schedules nothing; the daily step schedules it later", async () => {
    await client.execute("DELETE FROM app_settings");
    await setExchangeFlag(true);
    const ev = await addEvent(END);
    await scheduleRatingReminder(testDb, snapshot(ev), BEFORE);
    expect(await ratingJobs()).toHaveLength(0);

    await enableNotificationsForTest(testDb);
    const report = await runDailyNotifications(testDb, BEFORE);
    expect(report.errors).toEqual([]);
    const rows = await ratingJobs();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      jobKey: ratingJobKey(ev.id, END),
      runAt: RUN_AT,
      status: "scheduled",
    });
  });

  it("the daily step skips everything while the exchange flag is off", async () => {
    await setExchangeFlag(false);
    await addEvent(END);
    const report = await runDailyNotifications(testDb, BEFORE);
    expect(report.errors).toEqual([]);
    expect(await ratingJobs()).toHaveLength(0);
  });

  it("an event created 10 days ahead stores the reminder with no messageId; the daily step 7 days before runAt publishes it and saves the messageId, and a second daily run does not publish again", async () => {
    qstash.state.configured = true;
    const created = new Date("2026-11-02T14:00:00.000Z");
    const ev = await addEvent(END);
    await scheduleRatingReminder(testDb, snapshot(ev), created);
    let [row] = await ratingJobs();
    expect(row).toMatchObject({ status: "scheduled", messageId: null });
    expect(qstash.publishJob).not.toHaveBeenCalled();

    // 06:00 VN ngày 6/11 (= 23:00Z ngày 5/11): runAt còn 6 ngày 16 giờ.
    const daily = new Date("2026-11-05T23:00:00.000Z");
    await runDailyNotifications(testDb, daily);
    [row] = await ratingJobs();
    expect(row.messageId).toMatch(/^msg-/);
    expect(qstash.publishJob).toHaveBeenCalledTimes(1);

    await runDailyNotifications(testDb, new Date(daily.getTime() + DAY));
    const [again] = await ratingJobs();
    expect(again.messageId).toBe(row.messageId);
    expect(qstash.publishJob).toHaveBeenCalledTimes(1);
  });

  it("the daily step runs a missed one", async () => {
    const ev = await addEvent(END);
    const player = await addMember();
    await addReg(ev.id, player);
    await scheduleRatingReminder(testDb, snapshot(ev), BEFORE);
    // 06:00 VN hôm sau buổi: job quá giờ nhiều giờ mà vẫn scheduled.
    const daily = new Date("2026-11-12T23:00:00.000Z");
    const report = await runDailyNotifications(testDb, daily);
    expect(report.errors).toEqual([]);
    const [row] = await ratingJobs();
    expect(row.status).toBe("done");
    const sent = await reminders();
    expect(sent.map((n) => n.recipientId)).toEqual([player]);
  });

  it("scheduleRatingReminderAfterCommit re-reads the event after the response", async () => {
    const ev = await addEvent("2099-01-01T14:00:00.000Z");
    scheduleRatingReminderAfterCommit(ev.id);
    expect(await ratingJobs()).toHaveLength(0);
    await flush();
    const rows = await ratingJobs();
    expect(rows).toHaveLength(1);
    expect(rows[0].jobKey).toBe(
      ratingJobKey(ev.id, "2099-01-01T14:00:00.000Z"),
    );
  });
});

describe("runRatingReminder", () => {
  async function scheduledJob(ev: typeof exchangeEvents.$inferSelect) {
    await scheduleRatingReminder(testDb, snapshot(ev), BEFORE);
    const [row] = await ratingJobs();
    return row;
  }

  it("the runner notifies valid checked-in registrants who have not rated, never the host, a not-checked-in, locked or already-rated member", async () => {
    const ev = await addEvent(END);
    const ok1 = await addMember();
    const ok2 = await addMember({ approvalStatus: "pending" });
    const notChecked = await addMember();
    const locked = await addMember({ isActive: false });
    const rejectedAcc = await addMember({ approvalStatus: "rejected" });
    const alreadyRated = await addMember();
    const cancelledReg = await addMember();
    await addReg(ev.id, ok1);
    await addReg(ev.id, ok2);
    await addReg(ev.id, notChecked, { checkedIn: false });
    await addReg(ev.id, locked);
    await addReg(ev.id, rejectedAcc);
    await addReg(ev.id, alreadyRated);
    await addReg(ev.id, cancelledReg, { status: "cancelled" });
    // Host không có đăng ký; thêm dòng điểm danh của host vẫn không được nhận.
    await addReg(ev.id, ev.hostMemberId);
    await rated(ev.id, alreadyRated);

    const job = await scheduledJob(ev);
    expect(await runRatingReminder(testDb, job, AT_RUN, true)).toBe("done");
    const sent = await reminders();
    expect(sent.map((n) => n.recipientId).sort((a, b) => a - b)).toEqual(
      [ok1, ok2].sort((a, b) => a - b),
    );
    for (const n of sent) {
      expect(n.entityType).toBe("exchange_event");
      expect(n.entityId).toBe(ev.id);
      expect(n.dedupKey).toBe(`xrate:e${ev.id}:${fp(END)}:m${n.recipientId}`);
    }
  });

  it("payload has only eventCode and eventTitle", async () => {
    const ev = await addEvent(END);
    const player = await addMember();
    await addReg(ev.id, player);
    const job = await scheduledJob(ev);
    await runRatingReminder(testDb, job, AT_RUN, true);
    const [n] = await reminders();
    expect(n.payload).toEqual({
      eventCode: ev.publicCode,
      eventTitle: ev.title,
    });
  });

  it("the runner skips a cancelled or hidden event, a stale fingerprint, a closed window, and the exchange flag off", async () => {
    const ev = await addEvent(END);
    const player = await addMember();
    await addReg(ev.id, player);
    const job = await scheduledJob(ev);

    await testDb
      .update(exchangeEvents)
      .set({ status: "cancelled" })
      .where(eq(exchangeEvents.id, ev.id));
    expect(await runRatingReminder(testDb, job, AT_RUN, true)).toBe("skipped");
    await testDb
      .update(exchangeEvents)
      .set({ status: "open", hiddenAt: BEFORE.toISOString() })
      .where(eq(exchangeEvents.id, ev.id));
    expect(await runRatingReminder(testDb, job, AT_RUN, true)).toBe("skipped");
    await testDb
      .update(exchangeEvents)
      .set({ hiddenAt: null, endAt: "2026-11-12T14:30:00.000Z" })
      .where(eq(exchangeEvents.id, ev.id));
    expect(await runRatingReminder(testDb, job, AT_RUN, true)).toBe("skipped");
    await testDb
      .update(exchangeEvents)
      .set({ endAt: END })
      .where(eq(exchangeEvents.id, ev.id));
    expect(
      await runRatingReminder(
        testDb,
        job,
        new Date(Date.parse(END) + 7 * DAY),
        true,
      ),
    ).toBe("skipped");
    await setExchangeFlag(false);
    expect(await runRatingReminder(testDb, job, AT_RUN, true)).toBe("skipped");
    // Một job lạ không có buổi.
    expect(
      await runRatingReminder(
        testDb,
        { ...job, jobKey: ratingJobKey(999_999, END) },
        AT_RUN,
        true,
      ),
    ).toBe("skipped");
    expect(await reminders()).toHaveLength(0);

    await setExchangeFlag(true);
    expect(await runRatingReminder(testDb, job, AT_RUN, true)).toBe("done");
    expect(await reminders()).toHaveLength(1);
  });

  it("runJob skips the kind while notifications are off", async () => {
    const ev = await addEvent(END);
    const player = await addMember();
    await addReg(ev.id, player);
    const job = await scheduledJob(ev);
    await client.execute(
      "DELETE FROM app_settings WHERE key = 'notificationsEnabled'",
    );
    expect(await runJob(testDb, job, AT_RUN)).toBe("skipped");
    expect(await reminders()).toHaveLength(0);
  });

  it("running the job twice sends one notification per recipient", async () => {
    const ev = await addEvent(END);
    const a = await addMember();
    const b = await addMember();
    await addReg(ev.id, a);
    await addReg(ev.id, b);
    const job = await scheduledJob(ev);
    expect(await runJob(testDb, job, AT_RUN)).toBe("done");
    expect(await runJob(testDb, job, AT_RUN)).toBe("done");
    await finishJob(testDb, job.id, "done", AT_RUN);
    expect(await reminders()).toHaveLength(2);
  });

  it("a member who muted the Giao lưu group gets nothing; a verified email gets one mail via the outbox", async () => {
    const ev = await addEvent(END);
    const muted = await addMember();
    const withMail = await addMember({
      email: "p@example.test",
      notifyEmailVerifiedFor: "p@example.test",
    });
    await addReg(ev.id, muted);
    await addReg(ev.id, withMail);
    await testDb.insert(notificationPrefs).values({
      recipientType: "member",
      recipientId: muted,
      mutedGroups: ["exchange"],
      updatedAt: BEFORE.toISOString(),
    });
    const job = await scheduledJob(ev);
    await runRatingReminder(testDb, job, AT_RUN, true);
    await runRatingReminder(testDb, job, AT_RUN, true);
    const sent = await reminders();
    expect(sent.map((n) => n.recipientId)).toEqual([withMail]);
    const deliveries = await testDb.select().from(notificationDeliveries);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].recipientId).toBe(withMail);
    // Quá giờ yên lặng (22:00 VN = 15:00Z): drain lúc 07:00 VN hôm sau.
    await drainOutbox(testDb, { now: new Date("2026-11-13T00:30:00.000Z") });
    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
    expect(mailer.sendMail.mock.calls[0][0].to).toBe("p@example.test");
  });
});

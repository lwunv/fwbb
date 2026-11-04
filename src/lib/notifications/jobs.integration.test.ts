process.env.TZ = "UTC";
// Mail cần link tuyệt đối; thiếu thì delivery thất bại hẳn thay vì thử lại.
process.env.NEXT_PUBLIC_APP_URL ??= "https://fwbb.test";

import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import { appSettings, members, scheduledJobs, sessions } from "@/db/schema";
import type { MailMessage, MailOutcome } from "@/lib/mailer";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
}));
vi.mock("@/lib/messenger", () => ({
  sendGroupMessage: vi.fn(),
  buildNewSessionMessage: vi.fn(() => ""),
  buildConfirmedMessage: vi.fn(() => ""),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const mailer = vi.hoisted(() => ({
  sendMail: vi.fn<(msg: MailMessage) => Promise<MailOutcome>>(),
}));
vi.mock("@/lib/mailer", () => mailer);

// QStash giả: đếm lệnh đăng / huỷ, trả messageId tăng dần.
const qstash = vi.hoisted(() => {
  let n = 0;
  return {
    QSTASH_MAX_DELAY_MS: 7 * 24 * 3_600_000,
    publishJob: vi.fn<
      (job: {
        jobKey: string;
        runAt: Date;
        revision?: number;
      }) => Promise<{ messageId: string } | null>
    >(async () => ({ messageId: `msg-${++n}` })),
    cancelJobMessage: vi.fn<(id: string) => Promise<void>>(async () => {}),
  };
});
vi.mock("./qstash", () => qstash);

// Việc hẹn sau phản hồi: gom lại, test tự chạy đúng lúc muốn (sau commit).
const pending = vi.hoisted(() => [] as (() => Promise<unknown>)[]);
vi.mock("./after", () => ({
  runAfterResponse: (fn: () => Promise<unknown>) => {
    pending.push(fn);
  },
}));
async function flushAfter() {
  while (pending.length > 0) await pending.shift()!();
}

const { rescheduleSessionJobs, desiredSessionJobs } = await import("./jobs");
const { notify } = await import("./notify");
const { drainOutbox } = await import("./outbox");
const { setSessionTime } = await import("@/actions/sessions");
const { enableNotificationsForTest } = await import("./test-helpers");

const DAY_MS = 24 * 3_600_000;
// 2026-11-05 09:00 VN.
const NOW = new Date("2026-11-05T09:00:00+07:00");

async function reset() {
  for (const t of [
    "scheduled_jobs",
    "notification_deliveries",
    "notifications",
    "notification_prefs",
    "votes",
    "session_shuttlecocks",
    "sessions",
    "members",
    "app_settings",
  ]) {
    await client.execute(`DELETE FROM ${t}`);
  }
  pending.length = 0;
  qstash.publishJob.mockClear();
  qstash.cancelJobMessage.mockClear();
  mailer.sendMail.mockReset();
  mailer.sendMail.mockResolvedValue({ ok: true });
}

async function addSession(
  date: string,
  opts: { startTime?: string; voteDeadline?: string | null } = {},
) {
  const [s] = await testDb
    .insert(sessions)
    .values({
      date,
      status: "voting",
      startTime: opts.startTime ?? "20:30",
      voteDeadline:
        opts.voteDeadline === undefined
          ? `${date}T16:30:00`
          : opts.voteDeadline,
    })
    .returning({ id: sessions.id });
  return s.id;
}

async function jobRows() {
  return testDb
    .select()
    .from(scheduledJobs)
    .orderBy(scheduledJobs.runAt, scheduledJobs.jobKey);
}

const publishedKeys = () =>
  qstash.publishJob.mock.calls.map(([j]) => j.jobKey).sort();

describe("rescheduleSessionJobs", () => {
  beforeEach(async () => {
    await reset();
    await enableNotificationsForTest(testDb);
  });

  it("reschedule cancels stale jobs and publishes only jobs within 7 days", async () => {
    const near = await addSession("2026-11-07");
    // Buổi 10 ngày sau: mọi mốc ngoài cửa sổ 7 ngày của QStash.
    const far = await addSession("2026-11-15");

    await rescheduleSessionJobs(testDb, near, NOW);
    await rescheduleSessionJobs(testDb, far, NOW);
    const rows = await jobRows();
    expect(rows).toHaveLength(10);
    expect(rows.every((r) => r.status === "scheduled")).toBe(true);
    const nearRows = rows.filter((r) => r.sessionId === near);
    const farRows = rows.filter((r) => r.sessionId === far);
    expect(nearRows.every((r) => r.messageId !== null)).toBe(true);
    expect(farRows.every((r) => r.messageId === null)).toBe(true);
    expect(qstash.publishJob).toHaveBeenCalledTimes(5);
    for (const [job] of qstash.publishJob.mock.calls) {
      expect(job.runAt.getTime()).toBeLessThanOrEqual(
        NOW.getTime() + 7 * DAY_MS,
      );
    }

    // Chạy lại khi không đổi gì: không đăng lại, không huỷ gì.
    await rescheduleSessionJobs(testDb, near, NOW);
    expect(qstash.publishJob).toHaveBeenCalledTimes(5);
    expect(qstash.cancelJobMessage).not.toHaveBeenCalled();

    // Đổi giờ: 5 job cũ thành cancelled (huỷ message), 5 job mới được đăng.
    const oldIds = nearRows.map((r) => r.messageId);
    await testDb
      .update(sessions)
      .set({ startTime: "19:00" })
      .where(eq(sessions.id, near));
    await rescheduleSessionJobs(testDb, near, NOW);
    const after = (await jobRows()).filter((r) => r.sessionId === near);
    expect(after.filter((r) => r.status === "cancelled")).toHaveLength(5);
    expect(after.filter((r) => r.status === "scheduled")).toHaveLength(5);
    expect(qstash.cancelJobMessage.mock.calls.map(([id]) => id).sort()).toEqual(
      [...oldIds].sort(),
    );
    expect(qstash.publishJob).toHaveBeenCalledTimes(10);
  });

  it("deleted or cancelled session: every scheduled job is cancelled", async () => {
    const sid = await addSession("2026-11-07");
    await rescheduleSessionJobs(testDb, sid, NOW);
    await testDb
      .update(sessions)
      .set({ status: "cancelled" })
      .where(eq(sessions.id, sid));
    await rescheduleSessionJobs(testDb, sid, NOW);
    const rows = await jobRows();
    expect(rows.every((r) => r.status === "cancelled")).toBe(true);
    expect(qstash.cancelJobMessage).toHaveBeenCalledTimes(5);
  });

  it("time changed then changed back: the cancelled job is revived and republished", async () => {
    const sid = await addSession("2026-11-07");
    await rescheduleSessionJobs(testDb, sid, NOW);
    const original = await jobRows();

    await testDb
      .update(sessions)
      .set({ startTime: "19:00" })
      .where(eq(sessions.id, sid));
    await rescheduleSessionJobs(testDb, sid, NOW);
    await testDb
      .update(sessions)
      .set({ startTime: "20:30" })
      .where(eq(sessions.id, sid));
    qstash.publishJob.mockClear();
    await rescheduleSessionJobs(testDb, sid, NOW);

    const rows = await jobRows();
    const revived = rows.filter((r) =>
      original.some((o) => o.jobKey === r.jobKey),
    );
    expect(revived).toHaveLength(5);
    for (const r of revived) {
      expect(r.status).toBe("scheduled");
      const before = original.find((o) => o.jobKey === r.jobKey)!;
      // Message mới, không phải message đã bị huỷ.
      expect(r.messageId).not.toBeNull();
      expect(r.messageId).not.toBe(before.messageId);
    }
    expect(publishedKeys()).toEqual(original.map((r) => r.jobKey).sort());
    // Lần đăng lại không được trùng mã chống lặp của message đã huỷ (QStash
    // nhận nhưng bỏ qua message trùng mã), nên phải mang số lần hồi sinh.
    for (const [job] of qstash.publishJob.mock.calls) {
      expect(job.revision).toBe(1);
    }
    // Bộ giờ 19:00 giờ là cũ.
    expect(rows.filter((r) => r.status === "cancelled")).toHaveLength(5);
  });

  it("a job stored more than 7 days out is published by a later reschedule once inside the window", async () => {
    const sid = await addSession("2026-11-15");
    await rescheduleSessionJobs(testDb, sid, NOW);
    expect(qstash.publishJob).not.toHaveBeenCalled();
    expect((await jobRows()).every((r) => r.messageId === null)).toBe(true);

    // 3 ngày sau: mốc 08:00 ngày 15/11 VN và 17:30 VN đã vào cửa sổ 7 ngày.
    const later = new Date(NOW.getTime() + 3 * DAY_MS);
    await rescheduleSessionJobs(testDb, sid, later);
    const rows = await jobRows();
    const inWindow = desiredSessionJobs(
      {
        id: sid,
        date: "2026-11-15",
        startTime: "20:30",
        voteDeadline: "2026-11-15T16:30:00",
        status: "voting",
      },
      { courtLockHoursBefore: 4 },
      later,
    ).filter((j) => j.runAt.getTime() <= later.getTime() + 7 * DAY_MS);
    expect(inWindow.length).toBeGreaterThan(0);
    expect(publishedKeys()).toEqual(inWindow.map((j) => j.jobKey).sort());
    for (const r of rows) {
      const published = inWindow.some((j) => j.jobKey === r.jobKey);
      expect(r.messageId !== null).toBe(published);
    }
    // Không ai bị huỷ: vân tay buổi không đổi.
    expect(rows.every((r) => r.status === "scheduled")).toBe(true);
  });

  it("switch off: reschedule writes no scheduled_jobs row and never calls publishJob", async () => {
    await testDb
      .update(appSettings)
      .set({ value: "false" })
      .where(eq(appSettings.key, "notificationsEnabled"));
    const sid = await addSession("2026-11-07");
    await rescheduleSessionJobs(testDb, sid, NOW);
    await rescheduleSessionJobs(testDb, sid, NOW, false);
    expect(await jobRows()).toEqual([]);
    expect(qstash.publishJob).not.toHaveBeenCalled();
  });

  it("setSessionTime reschedules the session jobs after commit", async () => {
    // Buổi ngày mai theo giờ thật: action tự lấy `now`.
    const tomorrow = new Date(Date.now() + 2 * DAY_MS)
      .toISOString()
      .slice(0, 10);
    const sid = await addSession(tomorrow, { voteDeadline: null });
    const r = await setSessionTime(sid, "21:00", "23:00");
    expect(r).toEqual({ success: true });
    // Chưa chạy gì cho tới khi phản hồi xong.
    expect(await jobRows()).toEqual([]);
    await flushAfter();
    const rows = await jobRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.sessionId === sid)).toBe(true);
    expect(qstash.publishJob).toHaveBeenCalled();
  });
});

describe("outbox retry wake-up", () => {
  beforeEach(async () => {
    await reset();
    await enableNotificationsForTest(testDb);
  });

  it("a transient failure publishes an outbox_retry job at the retry minute", async () => {
    // 10:00:20 VN, ngoài giờ yên lặng.
    const t = new Date("2026-11-10T10:00:20+07:00");
    const email = "m1@example.test";
    const [m] = await testDb
      .insert(members)
      .values({
        name: "M1",
        facebookId: "fb-1",
        email,
        notifyEmailVerifiedFor: email,
      })
      .returning({ id: members.id });
    await notify(testDb, {
      kind: "password_changed",
      recipients: [{ type: "member", id: m.id }],
      payload: {},
      dedupBase: `pwd:m${m.id}:1`,
      now: t,
    });
    // Bỏ lượt drain sau phản hồi của notify: test tự drain với `now` cố định.
    pending.length = 0;

    mailer.sendMail.mockResolvedValue({ ok: false, code: "transient" });
    expect((await drainOutbox(testDb, { now: t })).deferred).toBe(1);
    // Không gọi mạng trong lúc drain: chỉ hẹn sau phản hồi.
    expect(qstash.publishJob).not.toHaveBeenCalled();
    await flushAfter();

    // Thử lại sau 5 phút = 03:05:20Z, làm tròn LÊN phút: 03:06.
    expect(qstash.publishJob).toHaveBeenCalledTimes(1);
    const [job] = qstash.publishJob.mock.calls[0];
    expect(job.jobKey).toBe("outbox_retry:2026-11-10T03:06");
    expect(job.runAt.toISOString()).toBe("2026-11-10T03:06:00.000Z");
    const published = await qstash.publishJob.mock.results[0].value;
    expect(published).not.toBeNull();
    const rows = await jobRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      jobKey: "outbox_retry:2026-11-10T03:06",
      kind: "outbox_retry",
      sessionId: null,
      runAt: "2026-11-10T03:06:00.000Z",
      status: "scheduled",
      messageId: published!.messageId,
    });
  });
});

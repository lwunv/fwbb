import { createHash } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { scheduledJobs, sessions } from "@/db/schema";
import type { DbOrTx } from "@/db/tx";
import {
  DEFAULT_PLAY_START_TIME,
  parseVoteDeadline,
} from "@/lib/vote-deadline";
import { runAfterResponse } from "./after";
import { courtLockAt, courtLockHoursBefore } from "./capacity";
import { isNotificationsEnabled } from "./gate";
import { publishJob, cancelJobMessage, QSTASH_MAX_DELAY_MS } from "./qstash";
import { isSessionJobKind, runSessionJob } from "./scheduled-events";
import { sessionStartInstant } from "./time";

const HOUR_MS = 3_600_000;

export type SessionJobKind =
  | "vote_due_24h"
  | "vote_due_2h"
  | "court_lock"
  | "day_morning"
  | "day_3h";

export type ScheduledJob = typeof scheduledJobs.$inferSelect;

type JobPayload = { revision?: number };

type SessionForJobs = {
  id: number;
  date: string;
  startTime: string | null;
  voteDeadline: string | null;
  status: string | null;
};

/**
 * Vân tay các trường quyết định giờ nhắc. KHÔNG chứa `status`: trạng thái được
 * `runJob` đọc lại lúc chạy, và buổi hủy/đã chốt thì không còn job nào; chứa
 * `status` thì `confirmSession` làm lệch mọi job.
 */
export function sessionFingerprint(s: {
  date: string;
  startTime: string;
  voteDeadline: string | null;
}): string {
  return createHash("sha256")
    .update(`${s.date}|${s.startTime}|${s.voteDeadline ?? ""}`)
    .digest("hex")
    .slice(0, 8);
}

/**
 * Các mốc nhắc một buổi cần (thuần). Mọi mốc tính theo giờ VN (`+07:00`), chỉ
 * lấy mốc sau `now`. Đổi giờ chơi hoặc hạn vote đổi vân tay nên đổi mọi key;
 * đổi `courtLockHoursBefore` chỉ đổi key `court_lock`.
 */
export function desiredSessionJobs(
  session: SessionForJobs,
  settings: { courtLockHoursBefore: number },
  now: Date,
): { kind: SessionJobKind; jobKey: string; runAt: Date }[] {
  if (session.status === "cancelled" || session.status === "completed") {
    return [];
  }
  const s = {
    date: session.date,
    startTime: session.startTime ?? DEFAULT_PLAY_START_TIME,
    voteDeadline: session.voteDeadline,
  };
  const fp = sessionFingerprint(s);
  const sid = `s${session.id}`;
  const start = sessionStartInstant(s.date, s.startTime).getTime();
  const deadline = s.voteDeadline
    ? parseVoteDeadline(s.voteDeadline).getTime()
    : null;
  const hours = settings.courtLockHoursBefore;

  const all: { kind: SessionJobKind; jobKey: string; runAt: Date }[] = [];
  if (deadline !== null) {
    all.push(
      {
        kind: "vote_due_24h",
        jobKey: `vote_due_24h:${sid}:${fp}`,
        runAt: new Date(deadline - 24 * HOUR_MS),
      },
      {
        kind: "vote_due_2h",
        jobKey: `vote_due_2h:${sid}:${fp}`,
        runAt: new Date(deadline - 2 * HOUR_MS),
      },
    );
  }
  all.push(
    {
      kind: "court_lock",
      jobKey: `court_lock:${sid}:h${hours}:${fp}`,
      runAt: courtLockAt(s, hours),
    },
    {
      kind: "day_morning",
      jobKey: `day_morning:${sid}:${fp}`,
      runAt: new Date(`${s.date}T08:00:00+07:00`),
    },
    {
      kind: "day_3h",
      jobKey: `day_3h:${sid}:${fp}`,
      runAt: new Date(start - 3 * HOUR_MS),
    },
  );
  return all.filter((j) => j.runAt.getTime() > now.getTime());
}

/** Công tắc: `gate` do action đọc sẵn; không truyền thì tự đọc 1 lần. */
async function enabled(db: DbOrTx, gate?: boolean): Promise<boolean> {
  if (gate !== undefined) return gate;
  return isNotificationsEnabled(db);
}

const withinQstashWindow = (runAt: Date, now: Date) =>
  runAt.getTime() <= now.getTime() + QSTASH_MAX_DELAY_MS;

/** Đăng message cho dòng chưa có `messageId` rồi lưu lại (không đè lượt đăng song song). */
async function publishRow(
  db: DbOrTx,
  row: { id: number; jobKey: string; runAt: Date; revision?: number },
  now: Date,
): Promise<void> {
  if (!withinQstashWindow(row.runAt, now)) return;
  const res = await publishJob({
    jobKey: row.jobKey,
    runAt: row.runAt,
    ...(row.revision ? { revision: row.revision } : {}),
  });
  if (!res) return;
  await db
    .update(scheduledJobs)
    .set({ messageId: res.messageId, updatedAt: now.toISOString() })
    .where(and(eq(scheduledJobs.id, row.id), isNull(scheduledJobs.messageId)));
}

/**
 * Đồng bộ `scheduled_jobs` của một buổi với các mốc mong muốn rồi đăng QStash.
 * (1) job `scheduled` không còn mong muốn → `cancelled` + huỷ message.
 * (2) job mong muốn: thêm mới, hoặc hồi sinh (dòng không còn `scheduled` hay
 * lệch `runAt` → huỷ message cũ, `messageId = null`). (3) dòng mong muốn chưa
 * có message và trong 7 ngày → đăng. Xa hơn giữ `null`, cron hằng ngày đăng sau.
 * Chạy sau commit (qua {@link scheduleSessionJobsAfterCommit}), gọi mạng được.
 */
export async function rescheduleSessionJobs(
  db: DbOrTx,
  sessionId: number,
  now: Date = new Date(),
  gate?: boolean,
): Promise<void> {
  if (!(await enabled(db, gate))) return;
  const nowIso = now.toISOString();

  const [session] = await db
    .select({
      id: sessions.id,
      date: sessions.date,
      startTime: sessions.startTime,
      voteDeadline: sessions.voteDeadline,
      status: sessions.status,
    })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  const desired = session
    ? desiredSessionJobs(
        session,
        { courtLockHoursBefore: await courtLockHoursBefore(db) },
        now,
      )
    : [];
  const desiredKeys = new Set(desired.map((j) => j.jobKey));

  const live = await db
    .select({
      id: scheduledJobs.id,
      jobKey: scheduledJobs.jobKey,
      messageId: scheduledJobs.messageId,
    })
    .from(scheduledJobs)
    .where(
      and(
        eq(scheduledJobs.sessionId, sessionId),
        eq(scheduledJobs.status, "scheduled"),
      ),
    );
  for (const row of live) {
    if (desiredKeys.has(row.jobKey)) continue;
    await db
      .update(scheduledJobs)
      .set({ status: "cancelled", updatedAt: nowIso })
      .where(
        and(
          eq(scheduledJobs.id, row.id),
          eq(scheduledJobs.status, "scheduled"),
        ),
      );
    if (row.messageId) await cancelJobMessage(row.messageId);
  }
  if (desired.length === 0) return;

  const existing = await db
    .select()
    .from(scheduledJobs)
    .where(
      inArray(
        scheduledJobs.jobKey,
        desired.map((j) => j.jobKey),
      ),
    );
  const byKey = new Map(existing.map((r) => [r.jobKey, r]));

  for (const job of desired) {
    const runAt = job.runAt.toISOString();
    const row = byKey.get(job.jobKey);
    if (!row) {
      const [inserted] = await db
        .insert(scheduledJobs)
        .values({
          jobKey: job.jobKey,
          kind: job.kind,
          sessionId,
          runAt,
          status: "scheduled",
          messageId: null,
          payload: {},
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .onConflictDoNothing({ target: scheduledJobs.jobKey })
        .returning({ id: scheduledJobs.id });
      // Lượt reschedule chạy song song vừa thêm cùng key: lượt đó đăng.
      if (inserted) {
        await publishRow(
          db,
          { id: inserted.id, jobKey: job.jobKey, runAt: job.runAt },
          now,
        );
      }
      continue;
    }

    const payload = (row.payload ?? {}) as JobPayload;
    let revision = payload.revision ?? 0;
    let messageId = row.messageId;
    if (row.status !== "scheduled" || row.runAt !== runAt) {
      if (row.messageId) await cancelJobMessage(row.messageId);
      revision += 1;
      messageId = null;
      await db
        .update(scheduledJobs)
        .set({
          status: "scheduled",
          runAt,
          messageId: null,
          payload: { ...payload, revision },
          updatedAt: nowIso,
        })
        .where(eq(scheduledJobs.id, row.id));
    }
    if (messageId === null) {
      await publishRow(
        db,
        { id: row.id, jobKey: job.jobKey, runAt: job.runAt, revision },
        now,
      );
    }
  }
}

/**
 * Điểm móc của các action đổi buổi: hẹn {@link rescheduleSessionJobs} sau khi
 * phản hồi đã gửi (sau commit, không gọi mạng trong tx). `gate === false` (cờ
 * action đã đọc) thì không hẹn gì.
 */
export function scheduleSessionJobsAfterCommit(
  sessionId: number,
  gate?: boolean,
): void {
  if (gate === false) return;
  runAfterResponse(async () => {
    // Import lúc chạy: không bắt mọi nơi import module này phải nạp client DB thật.
    const { db } = await import("@/db");
    await rescheduleSessionJobs(db, sessionId, new Date(), gate);
  });
}

/** `runAt` làm tròn LÊN phút: mọi delivery hẹn trong cùng phút dùng chung một lần đánh thức. */
function ceilToMinute(d: Date): Date {
  const ms = d.getTime();
  return new Date(Math.ceil(ms / 60_000) * 60_000);
}

/**
 * Đánh thức outbox đúng phút thử lại (hoặc hết giờ yên lặng). Gọi sau commit
 * với client DB thường, không phải trong transaction nghiệp vụ: nếu transaction
 * đó rollback thì job thừa này chỉ làm một lượt drain không có gì để gửi.
 */
export async function scheduleOutboxRetry(
  db: DbOrTx,
  runAt: Date,
  now: Date = new Date(),
): Promise<void> {
  if (!(await isNotificationsEnabled(db))) return;
  const at = ceilToMinute(runAt);
  const atIso = at.toISOString();
  const jobKey = `outbox_retry:${atIso.slice(0, 16)}`;
  const nowIso = now.toISOString();
  await db
    .insert(scheduledJobs)
    .values({
      jobKey,
      kind: "outbox_retry",
      sessionId: null,
      runAt: atIso,
      status: "scheduled",
      messageId: null,
      payload: {},
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .onConflictDoNothing({ target: scheduledJobs.jobKey });
  const [row] = await db
    .select({
      id: scheduledJobs.id,
      status: scheduledJobs.status,
      messageId: scheduledJobs.messageId,
    })
    .from(scheduledJobs)
    .where(eq(scheduledJobs.jobKey, jobKey))
    .limit(1);
  if (!row || row.status !== "scheduled" || row.messageId !== null) return;
  await publishRow(db, { id: row.id, jobKey, runAt: at }, now);
}

/**
 * Chạy một job đã tới giờ (route QStash và cron gọi). Các kind theo buổi nằm ở
 * `scheduled-events.ts`; kind chưa hỗ trợ → `"skipped"`. Task 19 điền
 * `weekly_summary` và `outbox_retry`.
 */
export async function runJob(
  db: DbOrTx,
  job: ScheduledJob,
  now: Date,
): Promise<"done" | "skipped"> {
  if (isSessionJobKind(job.kind)) {
    // Công tắc tắt: không đọc gì khác ngoài setting.
    if (!(await isNotificationsEnabled(db))) return "skipped";
    return runSessionJob(db, job, now, true);
  }
  return "skipped";
}

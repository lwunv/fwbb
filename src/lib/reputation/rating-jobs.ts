import "server-only";
import { createHash } from "node:crypto";
import { and, eq, gt, gte, isNull, lt, lte, ne, sql } from "drizzle-orm";
import {
  appSettings,
  exchangeEvents,
  exchangeRegistrations,
  hostFeedback,
  members,
  scheduledJobs,
} from "@/db/schema";
import type { DbOrTx } from "@/db/tx";
import { runAfterResponse } from "@/lib/notifications/after";
import { isNotificationsEnabled } from "@/lib/notifications/gate";
import {
  publishRow,
  scheduleOneOffJob,
  type ScheduledJob,
} from "@/lib/notifications/jobs";
import { notify } from "@/lib/notifications/notify";
import { cancelJobMessage, getQstashConfig } from "@/lib/notifications/qstash";
import { resolveGlobal } from "@/lib/settings-resolve";
import { RATING_JOB_KIND, RATING_REMINDER_DELAY_MS } from "./constants";
import { validCheckInSql } from "./eligibility";
import { feedbackWindow, windowClosed } from "./score";

/*
 * Nhắc chấm sau buổi giao lưu (G2d Task 14, quyết định 58-63). Một job một lần
 * trong `scheduled_jobs` của N1, khoá `xrate:{eventId}:{fp}` với `fp` là vân
 * tay của giờ kết thúc: đổi giờ thì khoá cũ tự lệch và bị bỏ qua lúc chạy.
 */

type EventForReminder = {
  id: number;
  endAt: string;
  status: string;
  hiddenAt: string | null;
};

type JobPayload = { revision?: number };

const DAY_MS = 24 * 3_600_000;
/** Bước cron quét buổi kết thúc trong chừng này ngày tới (khung QStash 7 ngày + 1). */
const DAILY_LOOKAHEAD_DAYS = 8;

function endFingerprint(endAt: string): string {
  return createHash("sha256").update(endAt).digest("hex").slice(0, 8);
}

/** Khoá job nhắc chấm của một buổi theo giờ kết thúc hiện tại. */
export function ratingJobKey(eventId: number, endAt: string): string {
  return `xrate:${eventId}:${endFingerprint(endAt)}`;
}

/**
 * Cờ giao lưu đọc trên `db` được truyền vào (một dòng `app_settings`), không
 * qua `getSettings()`: cron và route job chạy ngoài request và có thể nhận
 * transaction riêng.
 */
async function exchangeFlagOn(db: DbOrTx): Promise<boolean> {
  const rows = await db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, "exchangeEnabled"))
    .limit(1);
  return resolveGlobal(rows).exchangeEnabled === true;
}

/**
 * Đồng bộ job nhắc của một buổi. Thông báo tắt hoặc buổi huỷ/ẩn: mọi dòng
 * `scheduled` của buổi thành `cancelled` và huỷ message QStash. Buổi còn sống
 * mà đã qua giờ nhắc: giữ nguyên mọi dòng.
 * Còn lại: chỉ giữ đúng một dòng theo khoá hiện tại (dòng khoá cũ bị huỷ).
 * Dòng `cancelled` được hồi sinh với `revision` mới để QStash không bỏ message
 * vì trùng mã chống lặp. Dòng `scheduled` chưa có message (tạo lúc còn xa hơn
 * 7 ngày) được đăng khi đã vào khung (R3). Không có QStash thì chỉ lưu dòng,
 * cron hằng ngày chạy khi tới giờ: KHÔNG dùng nhánh "chạy ngay" của
 * `scheduleOneOffJob` cho job ở tương lai (quyết định 62).
 */
export async function scheduleRatingReminder(
  db: DbOrTx,
  ev: EventForReminder,
  now: Date,
  gate?: boolean,
): Promise<void> {
  const on = gate ?? (await isNotificationsEnabled(db));
  const key = ratingJobKey(ev.id, ev.endAt);
  const runAt = new Date(Date.parse(ev.endAt) + RATING_REMINDER_DELAY_MS);
  const nowIso = now.toISOString();
  const cancelAll = !on || ev.status === "cancelled" || ev.hiddenAt !== null;
  // Buổi còn sống mà đã qua giờ nhắc: không huỷ, không tạo, không hồi sinh.
  // Dòng đang chờ (vd admin bấm "bỏ ẩn" trên buổi vốn đang hiện) vẫn chạy được;
  // lúc chạy job tự kiểm lại buổi, người nhận và cửa sổ chấm.
  if (!cancelAll && runAt.getTime() <= now.getTime()) return;

  // Khoảng khoá của đúng buổi này (';' đứng ngay sau ':' trong bảng mã), đi
  // theo unique index `job_key`.
  const rows = await db
    .select({
      id: scheduledJobs.id,
      jobKey: scheduledJobs.jobKey,
      status: scheduledJobs.status,
      messageId: scheduledJobs.messageId,
      payload: scheduledJobs.payload,
    })
    .from(scheduledJobs)
    .where(
      and(
        gte(scheduledJobs.jobKey, `xrate:${ev.id}:`),
        lt(scheduledJobs.jobKey, `xrate:${ev.id};`),
      ),
    );

  for (const row of rows) {
    if (row.status !== "scheduled") continue;
    if (!cancelAll && row.jobKey === key) continue;
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
  if (cancelAll) return;

  const row = rows.find((r) => r.jobKey === key);
  if (!row) {
    if (getQstashConfig()) {
      await scheduleOneOffJob(
        db,
        {
          jobKey: key,
          kind: RATING_JOB_KIND,
          runAt,
          payload: { eventId: ev.id, endAt: ev.endAt },
        },
        now,
      );
      return;
    }
    await db
      .insert(scheduledJobs)
      .values({
        jobKey: key,
        kind: RATING_JOB_KIND,
        sessionId: null,
        runAt: runAt.toISOString(),
        status: "scheduled",
        messageId: null,
        payload: { eventId: ev.id, endAt: ev.endAt },
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .onConflictDoNothing({ target: scheduledJobs.jobKey });
    return;
  }

  const payload = (row.payload ?? {}) as JobPayload;
  if (row.status === "scheduled") {
    if (row.messageId === null) {
      await publishRow(
        db,
        { id: row.id, jobKey: key, runAt, revision: payload.revision },
        now,
      );
    }
    return;
  }
  // `done`/`skipped`: đã chạy rồi, không gửi lại.
  if (row.status !== "cancelled") return;
  const revision = (payload.revision ?? 0) + 1;
  const revived = await db
    .update(scheduledJobs)
    .set({
      status: "scheduled",
      messageId: null,
      payload: { ...payload, revision },
      updatedAt: nowIso,
    })
    .where(
      and(eq(scheduledJobs.id, row.id), eq(scheduledJobs.status, "cancelled")),
    )
    .returning({ id: scheduledJobs.id });
  // Lượt song song đã hồi sinh trước thì lượt đó đăng.
  if (revived.length > 0) {
    await publishRow(db, { id: row.id, jobKey: key, runAt, revision }, now);
  }
}

/**
 * Điểm móc của các action tạo, huỷ, ẩn và bỏ ẩn buổi: đọc lại buổi sau khi
 * phản hồi đã gửi (sau commit, không gọi mạng trong transaction) rồi đồng bộ
 * job nhắc. Buổi không còn thì huỷ mọi job của nó.
 */
export function scheduleRatingReminderAfterCommit(
  eventId: number,
  gate?: boolean,
): void {
  runAfterResponse(async () => {
    // Import lúc chạy: không bắt mọi nơi import module này phải nạp client DB thật.
    const { db } = await import("@/db");
    const [ev] = await db
      .select({
        id: exchangeEvents.id,
        endAt: exchangeEvents.endAt,
        status: exchangeEvents.status,
        hiddenAt: exchangeEvents.hiddenAt,
      })
      .from(exchangeEvents)
      .where(eq(exchangeEvents.id, eventId))
      .limit(1);
    if (!ev) return;
    await scheduleRatingReminder(db, ev, new Date(), gate);
  });
}

/** Tách `eventId` và vân tay từ khoá job; khoá lạ thì `null`. */
function parseJobKey(jobKey: string): number | null {
  const m = /^xrate:(\d+):[0-9a-f]{8}$/.exec(jobKey);
  return m ? Number(m[1]) : null;
}

/**
 * Thân job nhắc chấm (`runJob` gọi sau khi đã kiểm công tắc thông báo). Kiểm
 * lại mọi thứ lúc chạy (quyết định 60): cờ giao lưu, buổi còn, không huỷ, không
 * ẩn, giờ kết thúc khớp vân tay, cửa sổ chấm còn mở. Người nhận: điểm danh hợp
 * lệ, tài khoản hoạt động và không bị từ chối, chưa chấm host buổi này; host
 * không bao giờ nhận. Chạy lại an toàn: khoá chống lặp theo (buổi, vân tay,
 * người nhận).
 */
export async function runRatingReminder(
  db: DbOrTx,
  job: ScheduledJob,
  now: Date,
  gate: boolean,
): Promise<"done" | "skipped"> {
  if (!(await exchangeFlagOn(db))) return "skipped";
  const eventId = parseJobKey(job.jobKey);
  if (eventId === null) return "skipped";
  const [ev] = await db
    .select({
      id: exchangeEvents.id,
      publicCode: exchangeEvents.publicCode,
      title: exchangeEvents.title,
      endAt: exchangeEvents.endAt,
      status: exchangeEvents.status,
      hiddenAt: exchangeEvents.hiddenAt,
      hostMemberId: exchangeEvents.hostMemberId,
    })
    .from(exchangeEvents)
    .where(eq(exchangeEvents.id, eventId))
    .limit(1);
  if (!ev || ev.status === "cancelled" || ev.hiddenAt !== null) {
    return "skipped";
  }
  if (ratingJobKey(ev.id, ev.endAt) !== job.jobKey) return "skipped";
  // Cùng quy ước với `loadFeedbackContext`: đúng mốc endAt + 7 ngày là đã đóng.
  const state = windowClosed(ev.endAt, now)
    ? "closed"
    : feedbackWindow(ev.endAt, now);
  if (state !== "open") return "skipped";

  const rows = await db
    .selectDistinct({ memberId: exchangeRegistrations.memberId })
    .from(exchangeRegistrations)
    .innerJoin(
      exchangeEvents,
      eq(exchangeEvents.id, exchangeRegistrations.eventId),
    )
    .innerJoin(members, eq(members.id, exchangeRegistrations.memberId))
    .where(
      and(
        eq(exchangeRegistrations.eventId, ev.id),
        validCheckInSql(exchangeRegistrations, exchangeEvents),
        ne(exchangeRegistrations.memberId, ev.hostMemberId),
        eq(members.isActive, true),
        ne(members.approvalStatus, "rejected"),
        sql`NOT EXISTS (SELECT 1 FROM ${hostFeedback} WHERE ${hostFeedback.eventId} = ${ev.id} AND ${hostFeedback.fromMemberId} = ${exchangeRegistrations.memberId})`,
      ),
    );

  await notify(db, {
    kind: "exchange_rate_reminder",
    recipients: rows.map((r) => ({ type: "member", id: r.memberId })),
    payload: { eventCode: ev.publicCode, eventTitle: ev.title },
    dedupBase: `xrate:e${ev.id}:${endFingerprint(ev.endAt)}`,
    entity: { type: "exchange_event", id: ev.id },
    now,
    gate,
  });
  return "done";
}

/**
 * Bước `exchange_rating` của cron hằng ngày (cờ thông báo đã bật): khi cờ giao
 * lưu bật, đồng bộ job nhắc cho mọi buổi không huỷ, không ẩn, kết thúc trong 8
 * ngày tới mà giờ nhắc chưa qua (theo `exchange_events_end_at_idx`). Bù cho
 * buổi tạo lúc tắt thông báo và đăng QStash cho buổi tạo sớm hơn 7 ngày.
 * Trả số buổi đã xét. Truy vấn tách riêng để test EXPLAIN khoá index.
 */
export function dailyReminderEventsQuery(db: DbOrTx, now: Date) {
  return db
    .select({
      id: exchangeEvents.id,
      endAt: exchangeEvents.endAt,
      status: exchangeEvents.status,
      hiddenAt: exchangeEvents.hiddenAt,
    })
    .from(exchangeEvents)
    .where(
      and(
        gt(
          exchangeEvents.endAt,
          new Date(now.getTime() - RATING_REMINDER_DELAY_MS).toISOString(),
        ),
        lte(
          exchangeEvents.endAt,
          new Date(now.getTime() + DAILY_LOOKAHEAD_DAYS * DAY_MS).toISOString(),
        ),
        ne(exchangeEvents.status, "cancelled"),
        isNull(exchangeEvents.hiddenAt),
      ),
    );
}

/** Bước hằng ngày: đồng bộ job nhắc cho từng buổi của `dailyReminderEventsQuery`. */
export async function syncRatingRemindersDaily(
  db: DbOrTx,
  now: Date,
): Promise<number> {
  if (!(await exchangeFlagOn(db))) return 0;
  const rows = await dailyReminderEventsQuery(db, now);
  for (const ev of rows) {
    await scheduleRatingReminder(db, ev, now, true);
  }
  return rows.length;
}

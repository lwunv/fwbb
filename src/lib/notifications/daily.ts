import {
  and,
  asc,
  count,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
} from "drizzle-orm";
import {
  admins,
  financialTransactions,
  members,
  notificationDeliveries,
  notifications,
  scheduledJobs,
  sessions,
  venues,
} from "@/db/schema";
import type { DbOrTx } from "@/db/tx";
import { computeCourtRentReport } from "@/lib/court-rent-report";
import { dayOfWeekVN, ymdInVN, ymdInVNAddDays } from "@/lib/date-format";
import { computeBalanceFromTransactions } from "@/lib/fund-core";
import { sendMail } from "@/lib/mailer";
import { runReconcile } from "@/lib/reconcile-core";
import { NOTIFICATION_CATALOG, NOTIFICATION_KINDS } from "./catalog";
import {
  debtAgeDays,
  debtSinceYmd,
  type FinancialTransactionRow,
} from "./debt-age";
import { emailEligibleRecipients } from "./email-eligibility";
import { renderDigestEmail } from "./email-render";
import { isNotificationsEnabled } from "./gate";
import {
  finishJob,
  rescheduleSessionJobs,
  runJob,
  scheduleOneOffJob,
} from "./jobs";
import { notify } from "./notify";
import { drainOutbox } from "./outbox";
import { superadminRecipients, type Recipient } from "./recipients";
import type { NotificationView } from "./render";
import { notifySessionOpened } from "./session-events";
import { ensureUnsubToken } from "./tokens";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 3_600_000;

/** Nợ từ mức này trở lên mới nhắc (VND). */
const DEBT_REMINDER_MIN = 10_000;
/** Tuổi nợ (ngày) được nhắc member; quá 30 ngày thì chỉ còn báo admin. */
const DEBT_REMINDER_DAYS: ReadonlySet<number> = new Set([1, 7, 14, 30]);
const LONG_DEBT_DAYS = 30;
/** Tóm tắt tuần liệt kê tối đa chừng này người nợ lâu (nợ nhiều nhất trước). */
const WEEKLY_DEBTOR_LIST_MAX = 20;
/** Job quá giờ chừng này mà vẫn `scheduled` thì coi như QStash đã lỡ. */
const MISSED_JOB_GRACE_MS = 10 * MINUTE_MS;
const MISSED_JOB_LIMIT = 100;
const CLEANUP_BATCH = 500;

const FUND_TYPES = [
  "fund_contribution",
  "fund_deduction",
  "fund_refund",
] as const;

export type DailyReport = {
  opened: number;
  jobsRun: number;
  rescheduled: number;
  debtReminders: number;
  drained: number;
  rentChecked: boolean;
  reconcileChecked: boolean;
  cleaned: number;
  errors: string[];
};

type DebtState = {
  memberId: number;
  /** Tên hiển thị (nickname trước), chỉ dùng cho tin gửi admin. */
  name: string;
  balance: number;
  ageDays: number;
};

/**
 * Tên lỗi để chẩn đoán (`LibsqlError`, `TypeError`...), KHÔNG lấy message vì
 * message có thể chứa dữ liệu (câu SQL, email). Lỗi không phải Error → "unknown".
 */
function errorName(err: unknown): string {
  if (!(err instanceof Error)) return "unknown";
  if (err.name && err.name !== "Error") return err.name;
  return err.constructor?.name || "Error";
}

/**
 * Số dư và tuổi nợ của mọi member trong roster quỹ đang nợ. Đọc sổ đúng MỘT
 * lần cho mọi member (cùng câu ba loại quỹ như `runReconcile`); số dư tính
 * bằng `computeBalanceFromTransactions`, không tự cộng lại.
 */
async function loadDebtStates(
  db: DbOrTx,
  todayYmd: string,
): Promise<DebtState[]> {
  const [roster, rows] = await Promise.all([
    db
      .select({
        id: members.id,
        name: members.name,
        nickname: members.nickname,
      })
      .from(members)
      .where(
        and(eq(members.isActive, true), eq(members.approvalStatus, "approved")),
      ),
    db
      .select({
        id: financialTransactions.id,
        type: financialTransactions.type,
        amount: financialTransactions.amount,
        memberId: financialTransactions.memberId,
        reversalOfId: financialTransactions.reversalOfId,
        createdAt: financialTransactions.createdAt,
      })
      .from(financialTransactions)
      .where(inArray(financialTransactions.type, [...FUND_TYPES])),
  ]);
  const byMember = new Map<number, FinancialTransactionRow[]>();
  for (const r of rows) {
    if (r.memberId === null) continue;
    const list = byMember.get(r.memberId) ?? [];
    list.push(r);
    byMember.set(r.memberId, list);
  }
  const states: DebtState[] = [];
  for (const { id, name, nickname } of roster) {
    const txs = byMember.get(id) ?? [];
    const { balance } = computeBalanceFromTransactions(id, txs);
    if (balance >= 0) continue;
    const since = debtSinceYmd(txs, todayYmd);
    if (since === null) continue;
    states.push({
      memberId: id,
      name: nickname || name,
      balance,
      ageDays: debtAgeDays(since, todayYmd),
    });
  }
  return states;
}

/** Tháng VN liền trước `YYYY-MM-DD`. */
function previousMonth(ymd: string): {
  year: number;
  month: number;
  key: string;
} {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  const year = m === 1 ? y - 1 : y;
  const month = m === 1 ? 12 : m - 1;
  return { year, month, key: `${year}-${String(month).padStart(2, "0")}` };
}

/** Số việc chờ admin duyệt: tài khoản và sân đề xuất. */
async function pendingApprovals(db: DbOrTx): Promise<number> {
  const [[m], [v]] = await Promise.all([
    db
      .select({ n: count() })
      .from(members)
      .where(eq(members.approvalStatus, "pending")),
    db.select({ n: count() }).from(venues).where(eq(venues.status, "pending")),
  ]);
  return (m?.n ?? 0) + (v?.n ?? 0);
}

/**
 * Xoá dữ liệu thông báo cũ (quyết định 13), tối đa {@link CLEANUP_BATCH} dòng
 * mỗi bảng mỗi lần. `notifications` và `notification_deliveries` không có index
 * theo thời gian, nhưng `created_at` do app ghi lúc chèn nên tăng theo `id`:
 * tìm `id` đầu tiên còn trong hạn rồi chỉ quét các `id` nhỏ hơn (phần cũ),
 * không quét cả bảng. `scheduled_jobs` đi theo index `(status, run_at)`.
 */
async function cleanup(db: DbOrTx, now: Date): Promise<number> {
  const before = (days: number) =>
    new Date(now.getTime() - days * DAY_MS).toISOString();
  const n90 = before(90);
  const n30 = before(30);

  const [firstFreshNotif] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(gte(notifications.createdAt, n90))
    .orderBy(asc(notifications.id))
    .limit(1);
  const oldNotifs = await db
    .delete(notifications)
    .where(
      inArray(
        notifications.id,
        db
          .select({ id: notifications.id })
          .from(notifications)
          .where(
            and(
              firstFreshNotif
                ? lt(notifications.id, firstFreshNotif.id)
                : undefined,
              isNotNull(notifications.readAt),
              lt(notifications.createdAt, n90),
            ),
          )
          .orderBy(asc(notifications.id))
          .limit(CLEANUP_BATCH),
      ),
    )
    .returning({ id: notifications.id });

  const nd = notificationDeliveries;
  const [firstFreshDelivery] = await db
    .select({ id: nd.id })
    .from(nd)
    .where(gte(nd.createdAt, n30))
    .orderBy(asc(nd.id))
    .limit(1);
  const oldDeliveries = await db
    .delete(nd)
    .where(
      inArray(
        nd.id,
        db
          .select({ id: nd.id })
          .from(nd)
          .where(
            and(
              firstFreshDelivery ? lt(nd.id, firstFreshDelivery.id) : undefined,
              ne(nd.status, "pending"),
              lt(nd.createdAt, n30),
            ),
          )
          .orderBy(asc(nd.id))
          .limit(CLEANUP_BATCH),
      ),
    )
    .returning({ id: nd.id });

  const oldJobs = await db
    .delete(scheduledJobs)
    .where(
      inArray(
        scheduledJobs.id,
        db
          .select({ id: scheduledJobs.id })
          .from(scheduledJobs)
          .where(
            and(
              inArray(scheduledJobs.status, [
                "done",
                "skipped",
                "cancelled",
                "failed",
              ]),
              lt(scheduledJobs.updatedAt, n30),
            ),
          )
          .limit(CLEANUP_BATCH),
      ),
    )
    .returning({ id: scheduledJobs.id });

  return oldNotifs.length + oldDeliveries.length + oldJobs.length;
}

/**
 * Cron 06:00 VN: lưới an toàn và việc theo ngày. Mỗi bước chạy độc lập (lỗi
 * một bước ghi mã vào `errors`, các bước sau vẫn chạy). Không log dữ liệu
 * member, chỉ mã bước. Ngày/thứ/tháng đều tính theo giờ VN từ `now`.
 */
export async function runDailyNotifications(
  db: DbOrTx,
  now: Date,
): Promise<DailyReport> {
  const report: DailyReport = {
    opened: 0,
    jobsRun: 0,
    rescheduled: 0,
    debtReminders: 0,
    drained: 0,
    rentChecked: false,
    reconcileChecked: false,
    cleaned: 0,
    errors: [],
  };
  if (!(await isNotificationsEnabled(db))) return report;

  const today = ymdInVN(now);
  const step = async (code: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      const error = errorName(err);
      report.errors.push(`${code}:${error}`);
      console.error("[Notify] daily_step_failed", { step: code, error });
    }
  };
  // Sổ quỹ đọc một lần, dùng chung cho nhắc nợ và tóm tắt tuần.
  let debtStates: Promise<DebtState[]> | undefined;
  const getDebtStates = () => (debtStates ??= loadDebtStates(db, today));

  // 1. Báo "mở vote" cho buổi vào khung 48 giờ (lúc tạo buổi còn quá xa).
  await step("opened", async () => {
    const rows = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          gte(sessions.date, today),
          lte(sessions.date, ymdInVNAddDays(2, now)),
          inArray(sessions.status, ["voting", "confirmed"]),
        ),
      );
    for (const s of rows) {
      await notifySessionOpened(db, s.id, now, true);
      report.opened++;
    }
  });

  // 2. Job QStash lỡ (hoặc thiếu khoá): quá giờ 10 phút mà vẫn `scheduled`.
  // Dòng claim tóm tắt ngày ghi thẳng `done` nên không bao giờ lọt vào đây.
  await step("jobs", async () => {
    const due = await db
      .select()
      .from(scheduledJobs)
      .where(
        and(
          eq(scheduledJobs.status, "scheduled"),
          lt(
            scheduledJobs.runAt,
            new Date(now.getTime() - MISSED_JOB_GRACE_MS).toISOString(),
          ),
        ),
      )
      .orderBy(asc(scheduledJobs.runAt))
      .limit(MISSED_JOB_LIMIT);
    let firstError: unknown;
    let failed = false;
    for (const job of due) {
      try {
        await finishJob(db, job.id, await runJob(db, job, now), now);
        report.jobsRun++;
      } catch (err) {
        // Giữ `scheduled`: lượt sau thử lại; các job khác vẫn chạy.
        if (!failed) firstError = err;
        failed = true;
        console.error("[Notify] daily_job_failed", {
          kind: job.kind,
          error: errorName(err),
        });
      }
    }
    // Ném lại lỗi đầu tiên để `errors` mang đúng tên lỗi thật.
    if (failed) throw firstError;
  });

  // 3. Đồng bộ lịch nhắc của các buổi trong 8 ngày tới (đăng job mới vào
  // khung 7 ngày của QStash).
  await step("reschedule", async () => {
    const rows = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          gte(sessions.date, today),
          lte(sessions.date, ymdInVNAddDays(8, now)),
        ),
      );
    for (const s of rows) {
      await rescheduleSessionJobs(db, s.id, now, true);
      report.rescheduled++;
    }
  });

  // 4. Nhắc nợ theo tuổi nợ (quyết định 11), tối đa 1 tin/người/ngày.
  await step("debt", async () => {
    for (const d of await getDebtStates()) {
      if (d.balance > -DEBT_REMINDER_MIN || !DEBT_REMINDER_DAYS.has(d.ageDays))
        continue;
      const { inserted } = await notify(db, {
        kind: "debt_reminder",
        recipients: [{ type: "member", id: d.memberId }],
        payload: { amount: -d.balance, days: d.ageDays },
        dedupBase: `debt:m${d.memberId}:${today}`,
        now,
        gate: true,
      });
      report.debtReminders += inserted;
    }
  });

  // 5. Thứ 2: hẹn tóm tắt tuần cho superadmin lúc 08:00 VN.
  if (dayOfWeekVN(today) === 1) {
    await step("weekly", async () => {
      // Chụp lúc 06:00 (job chạy 08:00 không đọc lại sổ). Số tiền là số dư
      // âm đổi dấu, VND nguyên từ computeBalanceFromTransactions.
      const longDebtors = (await getDebtStates())
        .filter(
          (d) => d.balance <= -DEBT_REMINDER_MIN && d.ageDays > LONG_DEBT_DAYS,
        )
        .sort((a, b) => a.balance - b.balance || a.memberId - b.memberId);
      const [[upcoming], pendingCount] = await Promise.all([
        db
          .select({ n: count() })
          .from(sessions)
          .where(
            and(
              gte(sessions.date, today),
              lte(sessions.date, ymdInVNAddDays(6, now)),
              ne(sessions.status, "cancelled"),
            ),
          ),
        pendingApprovals(db),
      ]);
      await scheduleOneOffJob(
        db,
        {
          jobKey: `weekly_summary:${today}`,
          kind: "weekly_summary",
          runAt: new Date(`${today}T08:00:00+07:00`),
          payload: {
            debtorCount: longDebtors.length,
            upcomingCount: upcoming?.n ?? 0,
            pendingCount,
            debtors: longDebtors
              .slice(0, WEEKLY_DEBTOR_LIST_MAX)
              .map((d) => ({ name: d.name, amount: -d.balance })),
          },
        },
        now,
      );
    });
  }

  // 6. Mail tới hạn (thường bị dồn tới 07:00, cron mail gửi tiếp).
  await step("drain", async () => {
    report.drained = (await drainOutbox(db, { now })).sent;
  });

  // 7. Ngày 1 tới 5: tiền sân tháng VN trước còn thiếu.
  if (Number(today.slice(8, 10)) <= 5) {
    await step("rent", async () => {
      const prev = previousMonth(today);
      const rent = await computeCourtRentReport(db, prev.year);
      const month = rent.months.find((m) => m.month === prev.month);
      if (month && month.remaining > 0) {
        await notify(db, {
          kind: "court_rent_unpaid",
          recipients: await superadminRecipients(db),
          payload: { month: prev.key, amount: month.remaining },
          dedupBase: `rent:${prev.key}`,
          now,
          gate: true,
        });
      }
      report.rentChecked = true;
    });
  }

  // 8. Kiểm sổ quỹ (quyết định 12): chỉ báo số lỗi, không kèm số liệu member.
  await step("reconcile", async () => {
    const result = await runReconcile(db);
    const errorCount = result.issues.filter(
      (i) => i.severity === "error",
    ).length;
    if (errorCount > 0) {
      await notify(db, {
        kind: "reconcile_failed",
        recipients: await superadminRecipients(db),
        payload: { errorCount },
        dedupBase: `reconcile:${today}`,
        now,
        gate: true,
      });
    }
    report.reconcileChecked = true;
  });

  // 9. Dọn dữ liệu thông báo cũ (quyết định 13).
  await step("cleanup", async () => {
    report.cleaned = await cleanup(db, now);
  });

  return report;
}

const recipientKey = (r: Recipient) =>
  `${r.type === "member" ? "m" : "a"}${r.id}`;

const viewColumns = {
  id: notifications.id,
  recipientType: notifications.recipientType,
  recipientId: notifications.recipientId,
  kind: notifications.kind,
  entityType: notifications.entityType,
  entityId: notifications.entityId,
  payload: notifications.payload,
  mandatory: notifications.mandatory,
  readAt: notifications.readAt,
  createdAt: notifications.createdAt,
};

type DigestRow = NotificationView & {
  recipientType: Recipient["type"];
  recipientId: number;
};

/**
 * Tin chưa đọc trong 24 giờ qua cần gom vào tóm tắt: kind cấp `digest`, và tin
 * có mail bị bỏ vì chạm trần trong ngày. Chỉ đọc theo index: tin theo
 * `(người nhận, read_at, created_at)` của những người có email; delivery theo
 * `(status, next_attempt_at)` (lúc giữ chỗ luôn sau lúc tạo tin).
 */
async function digestCandidates(
  db: DbOrTx,
  since: string,
): Promise<Map<string, DigestRow[]>> {
  const digestKinds = NOTIFICATION_KINDS.filter(
    (k) => NOTIFICATION_CATALOG[k].level === "digest",
  );
  const [memberIds, adminIds] = await Promise.all([
    db
      .select({ id: members.id })
      .from(members)
      .where(isNotNull(members.notifyEmailVerifiedFor))
      .then((rows) => rows.map((r) => r.id)),
    db
      .select({ id: admins.id })
      .from(admins)
      .where(isNotNull(admins.email))
      .then((rows) => rows.map((r) => r.id)),
  ]);
  const ofType = (type: Recipient["type"], ids: number[]) =>
    ids.length === 0
      ? Promise.resolve([])
      : db
          .select(viewColumns)
          .from(notifications)
          .where(
            and(
              eq(notifications.recipientType, type),
              inArray(notifications.recipientId, ids),
              isNull(notifications.readAt),
              gte(notifications.createdAt, since),
              inArray(notifications.kind, digestKinds),
            ),
          );
  const nd = notificationDeliveries;
  const [forMembers, forAdmins, capped] = await Promise.all([
    ofType("member", memberIds),
    ofType("admin", adminIds),
    db
      .select(viewColumns)
      .from(nd)
      .innerJoin(notifications, eq(notifications.id, nd.notificationId))
      .where(
        and(
          eq(nd.status, "skipped"),
          gte(nd.nextAttemptAt, since),
          eq(nd.errorCode, "daily_cap"),
          isNull(notifications.readAt),
          gte(notifications.createdAt, since),
        ),
      ),
  ]);

  const byRecipient = new Map<string, DigestRow[]>();
  const seen = new Set<number>();
  for (const row of [...forMembers, ...forAdmins, ...capped] as DigestRow[]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const key = recipientKey({ type: row.recipientType, id: row.recipientId });
    const list = byRecipient.get(key) ?? [];
    list.push(row);
    byRecipient.set(key, list);
  }
  for (const list of byRecipient.values()) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
  }
  return byRecipient;
}

/**
 * Gửi tóm tắt ngày: mỗi người tối đa 1 mail mỗi ngày VN. Giữ chỗ bằng dòng
 * `scheduled_jobs` `digest:{ngày}:{m|a}{id}` chèn thẳng `done` (chèn trước,
 * trùng thì bỏ), nên cron chạy lại không gửi lần hai và bước quét job lỡ không
 * bao giờ nhặt nó. Gửi hỏng thì bỏ chỗ giữ để lượt sau trong ngày thử lại.
 */
async function sendDigests(db: DbOrTx, now: Date): Promise<number> {
  const since = new Date(now.getTime() - DAY_MS).toISOString();
  const byRecipient = await digestCandidates(db, since);
  if (byRecipient.size === 0) return 0;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (!appUrl) {
    console.error("[Notify] digest_failed", { code: "app_url_missing" });
    return 0;
  }
  const groups = [...byRecipient.values()];
  const recipients: Recipient[] = groups.map((items) => ({
    type: items[0].recipientType,
    id: items[0].recipientId,
  }));
  const targets = await emailEligibleRecipients(db, recipients);

  const today = ymdInVN(now);
  const nowIso = now.toISOString();
  let sent = 0;
  for (let i = 0; i < groups.length; i++) {
    const target = targets[i];
    if (!target) continue;
    const recipient = recipients[i];
    const items = groups[i];
    const [claim] = await db
      .insert(scheduledJobs)
      .values({
        jobKey: `digest:${today}:${recipientKey(recipient)}`,
        kind: "digest",
        sessionId: null,
        runAt: nowIso,
        status: "done",
        messageId: null,
        payload: {},
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .onConflictDoNothing({ target: scheduledJobs.jobKey })
      .returning({ id: scheduledJobs.id });
    if (!claim) continue;

    let code: string | null = null;
    try {
      let unsubscribeUrl: string | null = null;
      let headers: Record<string, string> | undefined;
      if (items.some((item) => !item.mandatory)) {
        const token = encodeURIComponent(await ensureUnsubToken(db, recipient));
        unsubscribeUrl = `${appUrl}/huy-nhan-thong-bao?token=${token}`;
        headers = {
          "List-Unsubscribe": `<${appUrl}/api/notifications/unsubscribe?token=${token}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        };
      }
      const mail = renderDigestEmail(items, {
        recipientType: recipient.type,
        recipientId: recipient.id,
        appUrl,
        unsubscribeUrl,
        manageUrl: `${appUrl}${recipient.type === "member" ? "/me" : "/admin/account"}`,
      });
      const outcome = await sendMail({ to: target.to, ...mail, headers });
      if (outcome.ok) sent++;
      else code = outcome.code;
    } catch {
      code = "internal";
    }
    if (code !== null) {
      console.error("[Notify] digest_failed", { code });
      await db.delete(scheduledJobs).where(eq(scheduledJobs.id, claim.id));
    }
  }
  return sent;
}

/**
 * Cron 07:00 VN (vừa hết giờ yên lặng): gửi mail đã dồn tới 07:00, rồi tóm tắt
 * ngày. Hai phần độc lập: một phần lỗi không chặn phần kia.
 */
export async function runMorningMail(
  db: DbOrTx,
  now: Date,
): Promise<{ digests: number; drained: number }> {
  const result = { digests: 0, drained: 0 };
  if (!(await isNotificationsEnabled(db))) return result;
  try {
    result.drained = (await drainOutbox(db, { now })).sent;
  } catch {
    console.error("[Notify] morning_mail_failed", { step: "drain" });
  }
  try {
    result.digests = await sendDigests(db, now);
  } catch {
    console.error("[Notify] morning_mail_failed", { step: "digest" });
  }
  return result;
}

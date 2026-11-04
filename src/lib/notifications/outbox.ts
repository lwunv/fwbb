import { and, asc, count, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  appSettings,
  notificationDeliveries,
  notifications,
} from "@/db/schema";
import type { DbOrTx } from "@/db/tx";
import {
  resolveBankAccount,
  type ResolvedBankAccount,
} from "@/lib/bank-account";
import { sendMail } from "@/lib/mailer";
import { resolveGlobal } from "@/lib/settings-resolve";
import { runAfterResponse } from "./after";
import { NOTIFICATION_CATALOG, type NotificationKind } from "./catalog";
import {
  emailEligibleRecipients,
  isEmailRecipientEligible,
} from "./email-eligibility";
import { renderNotificationEmail } from "./email-render";
import { isNotificationsEnabled } from "./gate";
import type { Recipient } from "./recipients";
import type { NotificationView } from "./render";
import { isQuietHourVN, nextQuietEndVN, startOfVNDay, vnDate } from "./time";
import { ensureUnsubToken } from "./tokens";

/** Mỗi người nhận tối đa 6 mail không bắt buộc mỗi ngày VN; tin vẫn ở chuông. */
export const OPTIONAL_EMAIL_DAILY_CAP = 6;
/** Phút chờ trước lần thử lại thứ 2..5 khi lỗi tạm thời. */
export const RETRY_BACKOFF_MINUTES = [5, 30, 120, 720] as const;
export const MAX_SEND_ATTEMPTS = RETRY_BACKOFF_MINUTES.length + 1;
/** Thời gian giữ chỗ một delivery khi đang gửi; sập giữa chừng thì hết hạn và thử lại. */
const LEASE_MS = 10 * 60_000;
const DEFAULT_DRAIN_LIMIT = 50;

type DrainOutcome = "sent" | "failed" | "deferred" | "skipped";
export type DrainResult = Record<DrainOutcome, number>;

/**
 * Điểm móc khi một delivery được hẹn ở tương lai (thử lại, hoặc dồn vì giờ yên
 * lặng). Hiện KHÔNG làm gì: Task 17 nối `publishJob` (QStash) vào đây để đánh
 * thức outbox đúng phút. Chưa nối thì các mốc này chờ lượt cron hằng ngày.
 * Phải không ném lỗi và không gọi mạng đồng bộ (có thể chạy trong transaction).
 */
export function onDeliveryDeferred(runAt: Date): void {
  void runAt;
}

/** Hẹn drain các delivery vừa xếp hàng sau khi phản hồi đã gửi (sau commit). */
export function scheduleOutboxDrain(deliveryIds: number[]): void {
  if (deliveryIds.length === 0) return;
  runAfterResponse(async () => {
    // Import lúc chạy: notify.ts kéo theo module này, không bắt mọi nơi gọi
    // notify phải nạp client DB thật.
    const { db } = await import("@/db");
    await drainOutbox(db, { ids: deliveryIds });
  });
}

/**
 * Thời điểm được gửi: ngay, hoặc 07:00 VN kế tiếp khi đang giờ yên lặng. Kind có
 * `quietHoursBypassSameDay` vẫn gửi ngay nếu buổi diễn ra trong ngày VN hôm nay.
 */
function firstAttemptAt(
  kind: NotificationKind,
  payload: unknown,
  now: Date,
): Date {
  if (!isQuietHourVN(now)) return now;
  const sessionDate = (payload as { sessionDate?: unknown } | null)
    ?.sessionDate;
  if (
    NOTIFICATION_CATALOG[kind].quietHoursBypassSameDay &&
    sessionDate === vnDate(now)
  ) {
    return now;
  }
  return nextQuietEndVN(now);
}

/**
 * Xếp hàng email cho các tin `notify` vừa chèn, trong cùng transaction. Chỉ kind
 * có email và không thuộc tóm tắt; chỉ người nhận đủ điều kiện lúc này (kiểm
 * lại lúc gửi). Việc gửi chạy sau phản hồi, không gọi mạng ở đây.
 */
export async function queueEmailDeliveries(
  db: DbOrTx,
  input: {
    kind: NotificationKind;
    payload: unknown;
    rows: {
      id: number;
      recipientType: Recipient["type"];
      recipientId: number;
    }[];
    now: Date;
  },
): Promise<void> {
  const def = NOTIFICATION_CATALOG[input.kind];
  if (!def.email || def.level === "digest" || input.rows.length === 0) return;

  const eligible = await emailEligibleRecipients(
    db,
    input.rows.map((r) => ({ type: r.recipientType, id: r.recipientId })),
  );
  const targets = input.rows.filter((_, i) => eligible[i] !== null);
  if (targets.length === 0) return;

  const runAt = firstAttemptAt(input.kind, input.payload, input.now);
  const queued = await db
    .insert(notificationDeliveries)
    .values(
      targets.map((r) => ({
        notificationId: r.id,
        recipientType: r.recipientType,
        recipientId: r.recipientId,
        channel: "email" as const,
        status: "pending" as const,
        attempts: 0,
        nextAttemptAt: runAt.toISOString(),
        createdAt: input.now.toISOString(),
      })),
    )
    .returning({ id: notificationDeliveries.id });

  if (runAt.getTime() > input.now.getTime()) onDeliveryDeferred(runAt);
  else scheduleOutboxDrain(queued.map((q) => q.id));
}

type DueRow = {
  id: number;
  recipientType: Recipient["type"];
  recipientId: number;
  notification: NotificationView;
};

/** Tài khoản nhận tiền cho QR trong mail nợ; thiếu số hoặc tên thì bỏ QR. */
async function loadBankAccount(
  db: DbOrTx,
): Promise<ResolvedBankAccount | undefined> {
  const rows = await db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(
      inArray(appSettings.key, ["bankBin", "bankAccountNo", "bankAccountName"]),
    );
  const bank = resolveBankAccount(resolveGlobal(rows), {
    accountNo: process.env.NEXT_PUBLIC_TIMO_ACCOUNT_NO ?? "",
    accountName: process.env.NEXT_PUBLIC_TIMO_ACCOUNT_NAME ?? "",
  });
  return bank.accountNo && bank.accountName ? bank : undefined;
}

/** Số mail không bắt buộc đã gửi cho người này từ 00:00 VN hôm nay. */
async function optionalSentToday(
  db: DbOrTx,
  r: Recipient,
  now: Date,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(notificationDeliveries)
    .innerJoin(
      notifications,
      eq(notifications.id, notificationDeliveries.notificationId),
    )
    .where(
      and(
        eq(notificationDeliveries.recipientType, r.type),
        eq(notificationDeliveries.recipientId, r.id),
        gte(notificationDeliveries.sentAt, startOfVNDay(now).toISOString()),
        eq(notificationDeliveries.status, "sent"),
        eq(notifications.mandatory, false),
      ),
    );
  return row?.n ?? 0;
}

async function deliverOne(
  db: DbOrTx,
  row: DueRow,
  now: Date,
  bank: () => Promise<ResolvedBankAccount | undefined>,
): Promise<DrainOutcome | null> {
  const nd = notificationDeliveries;
  const nowIso = now.toISOString();
  // Giữ chỗ: đẩy next_attempt_at qua hết lease, nên drain khác (kể cả chạy sau
  // khi dòng đã được giữ) không thấy dòng này tới hạn và không gửi lại.
  const claimed = await db
    .update(nd)
    .set({
      attempts: sql`${nd.attempts} + 1`,
      nextAttemptAt: new Date(now.getTime() + LEASE_MS).toISOString(),
    })
    .where(
      and(
        eq(nd.id, row.id),
        eq(nd.status, "pending"),
        lte(nd.nextAttemptAt, nowIso),
      ),
    )
    .returning({ attempts: nd.attempts });
  if (claimed.length === 0) return null;
  const attempts = claimed[0].attempts;

  // Chỉ lượt đang giữ chỗ được kết thúc dòng (lease hết hạn và bị lượt khác
  // giữ lại thì `attempts` đã đổi).
  const finish = (set: Partial<typeof nd.$inferInsert>) =>
    db
      .update(nd)
      .set(set)
      .where(
        and(
          eq(nd.id, row.id),
          eq(nd.status, "pending"),
          eq(nd.attempts, attempts),
        ),
      );
  // Với dòng `failed`, next_attempt_at giữ thời điểm lần thử cuối (getLastEmailFailure đọc).
  const fail = async (errorCode: string): Promise<DrainOutcome> => {
    await finish({ status: "failed", errorCode, nextAttemptAt: nowIso });
    console.error("[Notify] email_failed", {
      kind: row.notification.kind,
      code: errorCode,
    });
    return "failed";
  };
  const retryOrFail = async (errorCode: string): Promise<DrainOutcome> => {
    if (attempts >= MAX_SEND_ATTEMPTS) return fail(errorCode);
    const retryAt = new Date(
      now.getTime() + RETRY_BACKOFF_MINUTES[attempts - 1] * 60_000,
    );
    await finish({ errorCode, nextAttemptAt: retryAt.toISOString() });
    onDeliveryDeferred(retryAt);
    return "deferred";
  };

  const recipient: Recipient = { type: row.recipientType, id: row.recipientId };
  const item = row.notification;
  try {
    const target = await isEmailRecipientEligible(db, recipient);
    if (!target) {
      await finish({ status: "skipped", errorCode: "ineligible" });
      return "skipped";
    }
    if (
      !item.mandatory &&
      (await optionalSentToday(db, recipient, now)) >= OPTIONAL_EMAIL_DAILY_CAP
    ) {
      await finish({ status: "skipped", errorCode: "daily_cap" });
      return "skipped";
    }
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
    // Không có URL gốc thì mọi link trong mail hỏng: báo lỗi cấu hình, không gửi.
    if (!appUrl) return fail("app_url_missing");

    let unsubscribeUrl: string | null = null;
    let headers: Record<string, string> | undefined;
    if (!item.mandatory) {
      const token = encodeURIComponent(await ensureUnsubToken(db, recipient));
      unsubscribeUrl = `${appUrl}/huy-nhan-thong-bao?token=${token}`;
      headers = {
        "List-Unsubscribe": `<${appUrl}/api/notifications/unsubscribe?token=${token}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      };
    }
    const mail = renderNotificationEmail(item, {
      recipientType: recipient.type,
      recipientId: recipient.id,
      appUrl,
      unsubscribeUrl,
      manageUrl: `${appUrl}${recipient.type === "member" ? "/me" : "/admin/account"}`,
      bank: recipient.type === "member" ? await bank() : undefined,
    });

    const outcome = await sendMail({ to: target.to, ...mail, headers });
    if (outcome.ok) {
      await finish({ status: "sent", sentAt: nowIso, errorCode: null });
      return "sent";
    }
    return outcome.code === "transient"
      ? retryOrFail("transient")
      : fail(outcome.code);
  } catch {
    // Lỗi DB / render giữa chừng: coi như tạm thời, có trần số lần thử.
    console.error("[Notify] outbox_item_error", { kind: item.kind });
    return retryOrFail("internal");
  }
}

/**
 * Gửi các delivery `pending` đã tới hạn (theo index `(status, next_attempt_at)`).
 * Mỗi dòng được giữ chỗ trước khi gửi nên nhiều lượt drain chạy cùng lúc vẫn
 * gửi mỗi mail đúng một lần. Gọi sau phản hồi hoặc từ cron/job, không trong tx.
 */
export async function drainOutbox(
  db: DbOrTx,
  opts: { ids?: number[]; now?: Date; limit?: number } = {},
): Promise<DrainResult> {
  const result: DrainResult = { sent: 0, failed: 0, deferred: 0, skipped: 0 };
  if (opts.ids && opts.ids.length === 0) return result;
  if (!(await isNotificationsEnabled(db))) return result;

  const startedAt = opts.now ?? new Date();
  const nd = notificationDeliveries;
  const due = await db
    .select({
      id: nd.id,
      recipientType: nd.recipientType,
      recipientId: nd.recipientId,
      notification: {
        id: notifications.id,
        kind: notifications.kind,
        entityType: notifications.entityType,
        entityId: notifications.entityId,
        payload: notifications.payload,
        mandatory: notifications.mandatory,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      },
    })
    .from(nd)
    .innerJoin(notifications, eq(notifications.id, nd.notificationId))
    .where(
      and(
        eq(nd.status, "pending"),
        lte(nd.nextAttemptAt, startedAt.toISOString()),
        opts.ids ? inArray(nd.id, opts.ids) : undefined,
      ),
    )
    .orderBy(asc(nd.nextAttemptAt), asc(nd.id))
    .limit(opts.limit ?? DEFAULT_DRAIN_LIMIT);

  let bankPromise: Promise<ResolvedBankAccount | undefined> | undefined;
  const bank = () => (bankPromise ??= loadBankAccount(db));
  // Tuần tự: trần mail/ngày đếm trên các mail vừa gửi trong chính lượt này.
  for (const row of due) {
    const outcome = await deliverOne(
      db,
      // Cột `kind` là text; chỉ notify() ghi, luôn là kind trong catalog.
      row as DueRow,
      opts.now ?? new Date(),
      bank,
    );
    if (outcome) result[outcome]++;
  }
  return result;
}

/** Lần gửi mail thất bại gần nhất (trang cài đặt hiển thị), null nếu chưa có. */
export async function getLastEmailFailure(
  db: DbOrTx,
): Promise<{ at: string; errorCode: string } | null> {
  const nd = notificationDeliveries;
  const [row] = await db
    .select({ at: nd.nextAttemptAt, errorCode: nd.errorCode })
    .from(nd)
    .where(eq(nd.status, "failed"))
    .orderBy(desc(nd.nextAttemptAt))
    .limit(1);
  return row ? { at: row.at, errorCode: row.errorCode ?? "unknown" } : null;
}

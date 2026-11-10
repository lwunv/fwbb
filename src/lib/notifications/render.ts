import { formatSessionDate } from "@/lib/date-format";
import { formatVND } from "@/lib/utils";
import {
  NOTIFICATION_CATALOG,
  isNotificationKind,
  type NotificationKind,
} from "./catalog";

export type NotificationView = {
  id: number;
  kind: NotificationKind;
  entityType: string | null;
  entityId: number | null;
  payload: Record<string, unknown>;
  mandatory: boolean;
  readAt: string | null;
  createdAt: string;
};

/** `t` đã gắn sẵn namespace `notifications` (chuông và email đều truyền vào). */
export type Translate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

const MONEY_KEYS = new Set([
  "total",
  "oldTotal",
  "balance",
  "amount",
  "courtPrice",
  "playAmount",
  "dineAmount",
  "guestPlayAmount",
  "guestDineAmount",
  "guestToFund",
  "deposit",
  "remaining",
  "refundDue",
  "previousAmount",
]);
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/;
const VN_OFFSET_MS = 7 * 3_600_000;

/**
 * Mốc thời gian (ISO UTC) hiển thị theo giờ Việt Nam bất kể múi giờ máy chạy
 * (server Vercel là UTC), dạng "ngày/tháng HH:mm" theo locale.
 */
function formatVnInstant(iso: string, locale: "vi" | "en" | "zh"): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const vn = new Date(ms + VN_OFFSET_MS).toISOString(); // đọc bằng trường UTC
  return `${formatSessionDate(vn.slice(0, 10), "short", locale)} ${vn.slice(11, 16)}`;
}

/** rank 1 = sắp đầy, 2 = đầy, 3 trở lên = vượt sức chứa (spec 4.3). */
function capacityLevel(rank: unknown): "almost" | "full" | "over" {
  const n = Number(rank);
  return n <= 1 ? "almost" : n === 2 ? "full" : "over";
}

/**
 * Đổi payload thô thành giá trị đưa vào ICU. Tiền và ngày phải định dạng ở đây
 * (theo `locale` người xem) vì payload lưu dạng trung tính trong DB.
 */
function toValues(
  t: Translate,
  payload: Record<string, unknown>,
  locale: "vi" | "en" | "zh",
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, raw] of Object.entries(payload)) {
    if (MONEY_KEYS.has(key) && typeof raw === "number") {
      out[key] = formatVND(raw);
    } else if (key === "sessionDate" && typeof raw === "string") {
      out[key] = formatSessionDate(raw, "weekday", locale);
    } else if (key === "fields" && Array.isArray(raw)) {
      out[key] = raw.map((f) => t(`fields.${String(f)}`)).join(", ");
    } else if (Array.isArray(raw)) {
      out[key] = raw.join(", ");
    } else if (typeof raw === "string" && ISO_INSTANT.test(raw)) {
      out[key] = formatVnInstant(raw, locale);
    } else if (typeof raw === "number" || typeof raw === "string") {
      out[key] = raw;
    } else if (typeof raw === "boolean") {
      out[key] = String(raw);
    }
  }
  // Lý do có thể trống khi admin không nhập; tránh câu "Lý do: " bị cụt.
  if ("reason" in payload && !String(payload.reason ?? "").trim()) {
    out.reason = t("noReason");
  }
  return out;
}

export function renderNotification(
  t: Translate,
  item: NotificationView,
  locale: "vi" | "en" | "zh",
): { title: string; body: string } {
  // Kind lạ (bản cũ đọc tin của bản mới hơn) không được làm hỏng cả danh sách.
  if (!isNotificationKind(item.kind)) {
    return { title: t("kinds.unknown.title"), body: t("kinds.unknown.body") };
  }
  const values = toValues(t, item.payload ?? {}, locale);
  if (item.kind === "capacity_alert") {
    values.level = capacityLevel(item.payload?.rank);
  }
  if (item.kind === "session_deleted_refund") {
    // Âm = tiền pass của buổi bị rút lại; câu chữ nói chiều, số hiện trị tuyệt đối.
    const amount = Number(item.payload?.amount ?? 0);
    values.direction = amount < 0 ? "out" : "in";
    values.amount = formatVND(Math.abs(amount));
  }
  if (
    item.kind === "exchange_fee_locked" ||
    item.kind === "exchange_fee_changed"
  ) {
    // Một câu theo tình huống thay vì in cả 4 số: người đọc chỉ cần biết phải
    // trả thêm, được hoàn, hay cọc vừa đủ.
    const num = (k: string) => Number(item.payload?.[k] ?? 0);
    values.settle =
      num("remaining") > 0 ? "pay" : num("refundDue") > 0 ? "refund" : "even";
    values.hasDeposit = String(num("deposit") > 0);
    values.charged = String(num("amount") > 0);
  }
  if (
    item.kind === "exchange_registration_rejected" ||
    item.kind === "exchange_event_cancelled"
  ) {
    values.hasRefund = String(Number(item.payload?.refundDue ?? 0) > 0);
  }
  if (item.kind === "exchange_reported") {
    // Mã thô (spam, event...) phải dịch; mã lạ thì rơi về "other"/"unknown".
    const known = (group: string, code: unknown) =>
      typeof code === "string" && /^[a-z_]+$/.test(code)
        ? t(`${group}.${code}`)
        : t(`${group}.other`);
    values.targetType = known("reportTargets", item.payload?.targetType);
    values.reason = known("reportReasons", item.payload?.reason);
  }
  const body = t(`kinds.${item.kind}.body`, values);
  return {
    title: t(`kinds.${item.kind}.title`, values),
    body:
      item.kind === "weekly_summary"
        ? withDebtorList(t, body, item.payload)
        : body,
  };
}

/**
 * Tóm tắt tuần: thêm danh sách người nợ lâu ("Tên (số tiền)") sau câu số đếm,
 * kèm "và N người khác" khi tổng nhiều hơn danh sách. Job cũ không có
 * `debtors` thì giữ nguyên câu số đếm.
 */
function withDebtorList(
  t: Translate,
  body: string,
  payload: Record<string, unknown>,
): string {
  const raw = Array.isArray(payload.debtors) ? payload.debtors : [];
  const debtors = raw.filter(
    (d): d is { name: string; amount: number } =>
      typeof d?.name === "string" && Number.isInteger(d?.amount),
  );
  if (debtors.length === 0) return body;
  const total = Number(payload.debtorCount);
  const more = Number.isInteger(total)
    ? Math.max(0, total - debtors.length)
    : 0;
  const list = debtors
    .map((d) => `${d.name} (${formatVND(d.amount)})`)
    .join(", ");
  return `${body} ${t("kinds.weekly_summary.debtors", { list, more })}`;
}

/** Tin gửi host: trỏ tới trang quản lý buổi. */
const EXCHANGE_HOST_KINDS = new Set<NotificationKind>([
  "exchange_registration_received",
  "exchange_registration_cancelled",
  "exchange_cancelled_after_lock",
  "exchange_event_hidden",
]);

/**
 * Đích của tin, dựng lúc hiển thị (không lưu URL để đổi route không làm hỏng
 * tin cũ). Thiếu entityId thì rơi về trang danh sách tương ứng.
 */
export function notificationHref(
  item: NotificationView,
  scope: "member" | "admin",
): string {
  if (!isNotificationKind(item.kind)) {
    return scope === "admin" ? "/admin/dashboard" : "/";
  }
  const { group } = NOTIFICATION_CATALOG[item.kind];
  const id = item.entityId;
  if (scope === "admin" && item.kind === "exchange_reported") {
    return "/admin/exchanges";
  }
  if (scope === "admin" && item.kind === "venue_review_held") {
    return "/admin/exchanges?tab=reputation";
  }
  if (scope === "member" && group === "exchange_comments") {
    const code = item.payload?.eventCode;
    if (typeof code !== "string" || !code) return "/exchanges";
    // `qa` là khu công khai; `group` là Nhóm buổi. Tin chờ duyệt luôn về khu hỏi đáp.
    const channel =
      item.kind === "exchange_comment_host_post"
        ? "group"
        : item.kind === "exchange_comment_held"
          ? "qa"
          : item.payload?.channel === "group"
            ? "group"
            : "qa";
    return `/exchanges/${code}?channel=${channel}#comments`;
  }
  if (scope === "member" && group === "exchange") {
    const code = item.payload?.eventCode;
    if (typeof code !== "string" || !code) return "/exchanges";
    // Nhắc chấm mở thẳng phiếu chấm của buổi.
    if (item.kind === "exchange_rate_reminder") {
      return `/exchanges/${code}?feedback=1`;
    }
    return EXCHANGE_HOST_KINDS.has(item.kind)
      ? `/exchanges/${code}/manage`
      : `/exchanges/${code}`;
  }
  if (scope === "member") {
    switch (group) {
      case "session":
        return id != null ? `/vote/${id}` : "/";
      case "money":
        return "/my-fund";
      case "account":
        return "/me";
      case "venue":
        return "/venues";
      default:
        return "/";
    }
  }
  switch (group) {
    case "admin_session":
      return id != null ? `/admin/sessions/${id}` : "/admin/sessions";
    case "admin_members":
      return item.kind === "venue_pending" ? "/admin/venues" : "/admin/members";
    case "admin_inventory":
      return "/admin/inventory";
    case "admin_money":
      return item.kind === "court_rent_unpaid"
        ? "/admin/court-rent"
        : "/admin/finance";
    default:
      return "/admin/dashboard";
  }
}

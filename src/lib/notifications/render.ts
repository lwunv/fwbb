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

const MONEY_KEYS = new Set(["total", "balance", "amount"]);
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
  return {
    title: t(`kinds.${item.kind}.title`, values),
    body: t(`kinds.${item.kind}.body`, values),
  };
}

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
  if (scope === "member") {
    switch (group) {
      case "session":
        return id != null ? `/vote/${id}` : "/";
      case "money":
        return "/my-fund";
      case "account":
        return "/me";
      case "venue":
        return "/san";
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

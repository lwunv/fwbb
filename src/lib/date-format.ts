import { format } from "date-fns";
import { getDateFnsLocale, type AppLocale } from "./date-fns-locale";

export type SessionDateVariant =
  | "short" // 25/04
  | "long" // 25/04/2026
  | "weekday" // T6 25/04
  | "weekdayLong" // Thứ 6, 25/04/2026
  | "monthDay"; // 25 thg 4

const FORMATS: Record<SessionDateVariant, string> = {
  short: "dd/MM",
  long: "dd/MM/yyyy",
  weekday: "EEE dd/MM",
  weekdayLong: "EEEE, dd/MM/yyyy",
  monthDay: "dd 'thg' M",
};

/**
 * Format a session date string (YYYY-MM-DD) into a locale-aware display string.
 * Centralized so we don't drift between `vi`/`en`/`zh` and don't repeat the
 * `new Date(d + "T00:00:00")` boilerplate across components.
 */
export function formatSessionDate(
  dateStr: string | null | undefined,
  variant: SessionDateVariant = "long",
  locale: AppLocale = "vi",
): string {
  if (!dateStr) return "";
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  return format(d, FORMATS[variant], { locale: getDateFnsLocale(locale) });
}

/**
 * Returns the next session day (Mon/Wed/Fri schedule) from a reference date.
 * If today IS a session day, returns today.
 */
export function getNextSessionDay(ref: Date = new Date()): Date {
  const dow = ref.getDay(); // 0=Sun..6=Sat
  // Mon=1, Wed=3, Fri=5 are session days. Find next forward.
  const sessionDays = [1, 3, 5];
  let days = 7;
  for (const sd of sessionDays) {
    const diff = (sd - dow + 7) % 7;
    if (diff < days) days = diff;
  }
  const next = new Date(ref);
  next.setDate(ref.getDate() + days);
  return next;
}

/** @deprecated Use {@link getNextSessionDay}. Kept for backward compatibility. */
export const getNextMondayOrFriday = getNextSessionDay;

/**
 * `sessions.date` được lưu YYYY-MM-DD theo giờ Việt Nam (UTC+7). Hàm này
 * trả về YYYY-MM-DD của một thời điểm bất kỳ ở múi giờ VN — dùng cho mọi
 * filter "today / tomorrow" trên cả server lẫn client.
 *
 * Server Vercel chạy UTC nên `new Date().toISOString()` không khớp được
 * ranh giới ngày của VN; phải đi qua Intl với timeZone tường minh.
 */
export function ymdInVN(ref: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ref);
}

/** YYYY-MM-DD ở múi giờ VN sau khi cộng `days` ngày so với `ref`. */
export function ymdInVNAddDays(days: number, ref: Date = new Date()): string {
  const ms = ref.getTime() + days * 24 * 60 * 60 * 1000;
  return ymdInVN(new Date(ms));
}

/** Số nguyên ngày-trong-tuần (0=CN..6=T7) của `ymd` interpreted as VN date. */
export function dayOfWeekVN(ymd: string): number {
  // Đặt giờ ở giữa ngày VN để tránh edge case DST/midnight.
  return new Date(`${ymd}T12:00:00+07:00`).getUTCDay();
}

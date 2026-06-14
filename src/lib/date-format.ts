import { format } from "date-fns";
import { getDateFnsLocale, type AppLocale } from "./date-fns-locale";

export type SessionDateVariant =
  | "short" // 25/04
  | "long" // 25/04/2026
  | "weekday" // T6 25/04
  | "weekdayLong" // Thứ 6, 25/04/2026
  | "weekdayName" // Thứ Sáu
  | "monthDay"; // 25 thg 4

const FORMATS: Record<SessionDateVariant, string> = {
  short: "dd/MM",
  long: "dd/MM/yyyy",
  weekday: "EEE dd/MM",
  weekdayLong: "EEEE, dd/MM/yyyy",
  weekdayName: "EEEE",
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

/** Default subscription days of the week — Mon(1), Wed(3), Fri(5). */
export const DEFAULT_SESSION_DAYS = [1, 3, 5] as const;

/**
 * Returns the next session day (Mon/Wed/Fri schedule) from a reference date.
 * If today IS a session day, returns today.
 */
export function getNextSessionDay(ref: Date = new Date()): Date {
  const dow = ref.getDay(); // 0=Sun..6=Sat
  let days = 7;
  for (const sd of DEFAULT_SESSION_DAYS) {
    const diff = (sd - dow + 7) % 7;
    if (diff < days) days = diff;
  }
  const next = new Date(ref);
  next.setDate(ref.getDate() + days);
  return next;
}

/**
 * True nếu YYYY-MM-DD rơi vào 1 trong các ngày subscription cố định. Dùng
 * để quyết định giá sân: "buổi mặc định" ăn giá tháng (`pricePerSession`),
 * "buổi lẻ" ăn `pricePerSessionRetail`.
 *
 * `sessionDays` (0=Sun..6=Sat) — admin có thể configure qua
 * `getSessionDaysOfWeek()`. Pass undefined / empty → fallback M/W/F.
 * Caller server-side BẮT BUỘC pass `await getSessionDaysOfWeek()` để tránh
 * hardcode lịch khác setting thật (latent over-charge bug — xem
 * [[project-finance-money-flow-bugs]]).
 *
 * Parse trực tiếp Y/M/D ra `Date` UTC để KHÔNG lệch khi server chạy ở timezone
 * khác VN (ymd là VN-local date string).
 */
export function isDefaultSessionDay(
  ymd: string,
  sessionDays?: readonly number[] | number[],
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [y, m, d] = ymd.split("-").map(Number);
  // UTC để getUTCDay() ổn định bất kể timezone server.
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const days =
    sessionDays && sessionDays.length > 0 ? sessionDays : DEFAULT_SESSION_DAYS;
  return (days as readonly number[]).includes(dow);
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

/**
 * Các ngày YYYY-MM-DD (VN) của những thứ cầu lông trong TUẦN ĐÍCH — dùng cho
 * selector trang user. Tuần đích = tuần HIỆN TẠI (T2→CN); nếu hôm nay là
 * T7/CN → TUẦN SAU (lịch tuần này đã chơi hết). Kết quả sort theo thứ tự trong
 * tuần (Mon→Sun).
 *
 * @param todayYmd   hôm nay theo VN (dùng `ymdInVN()`).
 * @param badmintonDays  dow 0=CN..6=T7 (từ `getSessionDaysOfWeek()`); rỗng → M/W/F.
 */
export function badmintonDatesForTargetWeek(
  todayYmd: string,
  badmintonDays?: readonly number[] | number[],
): string[] {
  const days =
    badmintonDays && badmintonDays.length > 0
      ? badmintonDays
      : DEFAULT_SESSION_DAYS;
  const todayDow = dayOfWeekVN(todayYmd); // 0=CN..6=T7
  const base = new Date(`${todayYmd}T12:00:00+07:00`);
  const addDays = (n: number) =>
    ymdInVN(new Date(base.getTime() + n * 86_400_000));
  // Offset từ Thứ Hai (tuần bắt đầu T2): T2→0, T3→1, …, CN→6.
  const fromMonday = (dow: number) => (dow === 0 ? 6 : dow - 1);
  // T7(6)/CN(0) → tuần sau.
  const weekShift = todayDow === 6 || todayDow === 0 ? 7 : 0;
  const mondayOffset = -fromMonday(todayDow) + weekShift;
  return [...days]
    .sort((a, b) => fromMonday(a) - fromMonday(b))
    .map((dow) => addDays(mondayOffset + fromMonday(dow)));
}

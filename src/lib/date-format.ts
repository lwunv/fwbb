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

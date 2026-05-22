/**
 * Helpers for the vote-deadline ISO-local-time format described in
 * `docs/superpowers/specs/2026-05-21-vote-deadline-design.md`.
 *
 * Format: `YYYY-MM-DDTHH:MM:SS` (no `Z`, no timezone offset). Interpreted as
 * Vietnam local time — same convention as `sessions.date` / `sessions.startTime`.
 * `new Date(deadlineStr)` parses this as local time consistently across
 * Node and browsers, which is what we want (no TZ math at the boundary).
 */

/**
 * Default session start time used when constructing a new session without an
 * explicit start time (cron auto-create, getNextSession auto-create, manual
 * create with empty startTime). Used by `computeDefaultDeadline` to derive
 * the default vote deadline = startTime − 4h.
 *
 * If the group's regular play time changes, update this single constant.
 */
export const DEFAULT_PLAY_START_TIME = "20:30";

export function formatLocalDeadline(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Default per-session deadline: `startTime − 4 hours`. Used by every session
 * creation path (manual, cron, admin auto-create).
 *
 * @param date YYYY-MM-DD
 * @param startTime HH:MM (24h)
 */
export function computeDefaultDeadline(
  date: string,
  startTime: string,
): string {
  const start = new Date(`${date}T${startTime}:00`);
  const deadline = new Date(start.getTime() - 4 * 60 * 60 * 1000);
  return formatLocalDeadline(deadline);
}

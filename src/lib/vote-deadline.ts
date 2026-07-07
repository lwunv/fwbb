/**
 * Helpers for the vote-deadline ISO-local-time format described in
 * `docs/superpowers/specs/2026-05-21-vote-deadline-design.md`.
 *
 * Format: `YYYY-MM-DDTHH:MM:SS` (no `Z`, no timezone offset). Interpreted as
 * Vietnam local time — same convention as `sessions.date` / `sessions.startTime`.
 *
 * WARNING: a bare `new Date(deadlineStr)` parses the string in the RUNTIME's
 * local timezone. On the Vercel server (UTC) that reads a VN wall-clock as UTC,
 * i.e. ~7h late — which kept voting open long past the real deadline. Always
 * compare via `parseVoteDeadline()` (below), which pins the string to +07:00 so
 * the instant is correct on both the UTC server and a VN-local browser.
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
 * Parse a stored vote-deadline (VN local wall-clock, no offset) into a real
 * instant by pinning it to Vietnam time (+07:00). TZ-independent: gives the
 * same instant whether it runs on the UTC server or a VN-local browser, so the
 * server-side vote gate and SSR agree. Use this for every deadline comparison
 * instead of a bare `new Date(deadline)`.
 */
export function parseVoteDeadline(deadline: string): Date {
  return new Date(`${deadline}+07:00`);
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

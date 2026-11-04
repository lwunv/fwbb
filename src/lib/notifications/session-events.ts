import { eq } from "drizzle-orm";
import { courts, sessions } from "@/db/schema";
import type { DbOrTx } from "@/db/tx";
import { isVoteOpen, type SessionStatus } from "@/lib/session-status";
import {
  DEFAULT_PLAY_START_TIME,
  parseVoteDeadline,
} from "@/lib/vote-deadline";
import { isNotificationsEnabled, notify } from "./notify";
import { groupMemberRecipients, sessionVoteRecipients } from "./recipients";
import { sessionStartInstant } from "./time";

/** Buổi xa hơn mốc này chưa báo "mở vote"; cron hằng ngày báo khi vào khung. */
const OPEN_WINDOW_MS = 48 * 3_600_000;
/** Default của cột `sessions.end_time`. */
const DEFAULT_END_TIME = "22:30";

export type SessionChangeField = "time" | "court" | "price";

/** Công tắc: `gate` do action đọc sẵn; không truyền thì tự đọc 1 lần. */
async function enabled(db: DbOrTx, gate?: boolean): Promise<boolean> {
  if (gate !== undefined) return gate;
  return isNotificationsEnabled(db);
}

async function loadSession(db: DbOrTx, sessionId: number) {
  const [row] = await db
    .select({
      id: sessions.id,
      date: sessions.date,
      startTime: sessions.startTime,
      endTime: sessions.endTime,
      status: sessions.status,
      voteDeadline: sessions.voteDeadline,
      courtPrice: sessions.courtPrice,
      courtName: courts.name,
    })
    .from(sessions)
    .leftJoin(courts, eq(courts.id, sessions.courtId))
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (!row) return undefined;
  // Cột có default trong schema nhưng kiểu vẫn nullable; dùng đúng default đó.
  return {
    ...row,
    startTime: row.startTime ?? DEFAULT_PLAY_START_TIME,
    endTime: row.endTime ?? DEFAULT_END_TIME,
    status: (row.status ?? "voting") as SessionStatus,
  };
}

const sessionEntity = (id: number) => ({ type: "session" as const, id });

/**
 * "Buổi mới mở vote" cho mọi member nhóm. Chỉ gửi khi buổi còn mở vote và bắt
 * đầu trong 48 giờ tới; dedup theo buổi nên gọi lại (cron) không gửi trùng.
 */
export async function notifySessionOpened(
  db: DbOrTx,
  sessionId: number,
  now: Date = new Date(),
  gate?: boolean,
): Promise<void> {
  if (!(await enabled(db, gate))) return;
  const s = await loadSession(db, sessionId);
  if (!s) return;
  if (s.status !== "voting" && s.status !== "confirmed") return;
  if (!isVoteOpen(s, now).open) return;
  const startsIn =
    sessionStartInstant(s.date, s.startTime).getTime() - now.getTime();
  if (startsIn > OPEN_WINDOW_MS) return;
  await notify(db, {
    kind: "session_opened",
    recipients: await groupMemberRecipients(db),
    payload: { sessionDate: s.date, startTime: s.startTime },
    dedupBase: `sopen:s${sessionId}`,
    entity: sessionEntity(sessionId),
    now,
  });
}

/**
 * Đổi giờ / sân / giá sân, gửi người đã vote chơi hoặc ăn. Nhiều trường đổi
 * trong cùng một thao tác gộp thành một tin. `token` = ISO thời điểm thao tác.
 */
export async function notifySessionChanged(
  db: DbOrTx,
  sessionId: number,
  fields: SessionChangeField[],
  token: string,
  gate?: boolean,
): Promise<void> {
  if (fields.length === 0) return;
  if (!(await enabled(db, gate))) return;
  const s = await loadSession(db, sessionId);
  if (!s) return;
  await notify(db, {
    kind: "session_changed",
    recipients: await sessionVoteRecipients(db, sessionId, "voted"),
    payload: {
      sessionDate: s.date,
      startTime: s.startTime,
      endTime: s.endTime,
      courtName: s.courtName ?? null,
      courtPrice: s.courtPrice ?? null,
      fields,
    },
    dedupBase: `schg:s${sessionId}:${fields.join("+")}:${token}`,
    entity: sessionEntity(sessionId),
  });
}

async function notifyVoters(
  db: DbOrTx,
  sessionId: number,
  kind: "session_cancelled" | "session_reopened",
  dedupBase: string,
  gate?: boolean,
): Promise<void> {
  if (!(await enabled(db, gate))) return;
  const s = await loadSession(db, sessionId);
  if (!s) return;
  await notify(db, {
    kind,
    // Hủy buổi không xoá vote, nên "đã vote" vẫn đúng người cần báo.
    recipients: await sessionVoteRecipients(db, sessionId, "voted"),
    payload: { sessionDate: s.date, startTime: s.startTime },
    dedupBase,
    entity: sessionEntity(sessionId),
  });
}

export async function notifySessionCancelled(
  db: DbOrTx,
  sessionId: number,
  token: string,
  gate?: boolean,
): Promise<void> {
  await notifyVoters(
    db,
    sessionId,
    "session_cancelled",
    `scancel:s${sessionId}:${token}`,
    gate,
  );
}

export async function notifySessionReopened(
  db: DbOrTx,
  sessionId: number,
  token: string,
  gate?: boolean,
): Promise<void> {
  await notifyVoters(
    db,
    sessionId,
    "session_reopened",
    `sreopen:s${sessionId}:${token}`,
    gate,
  );
}

/** Vote mở lại / gia hạn: chỉ báo người chưa vote. */
export async function notifyVoteReopened(
  db: DbOrTx,
  sessionId: number,
  token: string,
  gate?: boolean,
): Promise<void> {
  if (!(await enabled(db, gate))) return;
  const s = await loadSession(db, sessionId);
  if (!s) return;
  await notify(db, {
    kind: "vote_reopened",
    recipients: await sessionVoteRecipients(db, sessionId, "notVoted"),
    payload: {
      sessionDate: s.date,
      startTime: s.startTime,
      voteDeadline: s.voteDeadline ?? null,
    },
    dedupBase: `vreopen:s${sessionId}:${token}`,
    entity: sessionEntity(sessionId),
  });
}

/**
 * Đổi hạn vote có đáng báo "vote mở lại" không: hạn mới phải còn ở tương lai
 * (hoặc bỏ hạn) VÀ vote đang đóng trước đó hoặc hạn mới muộn hơn hạn cũ. Bỏ
 * hạn (null) tính là muộn hơn mọi hạn; đặt hạn cho buổi chưa có hạn thì không.
 */
export function shouldNotifyVoteReopened(
  before: { status: SessionStatus; voteDeadline: string | null },
  nextDeadline: string | null,
  now: Date,
): boolean {
  if (nextDeadline !== null && parseVoteDeadline(nextDeadline) <= now) {
    return false;
  }
  if (!isVoteOpen(before, now).open) return true;
  if (before.voteDeadline === null) return false;
  if (nextDeadline === null) return true;
  return (
    parseVoteDeadline(nextDeadline) > parseVoteDeadline(before.voteDeadline)
  );
}

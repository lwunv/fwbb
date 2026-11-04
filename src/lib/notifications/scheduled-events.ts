import { eq } from "drizzle-orm";
import { courts, sessions } from "@/db/schema";
import type { DbOrTx } from "@/db/tx";
import { MAX_PLAY_SLOTS } from "@/lib/vote-capacity";
import { isVoteOpen, type SessionStatus } from "@/lib/session-status";
import { DEFAULT_PLAY_START_TIME } from "@/lib/vote-deadline";
import { courtLockHoursBefore, currentHeadcount } from "./capacity";
import { notify } from "./notify";
import {
  memberName,
  sessionVoteRecipients,
  superadminRecipients,
} from "./recipients";
import { sessionStartInstant } from "./time";
import {
  sessionFingerprint,
  type ScheduledJob,
  type SessionJobKind,
} from "./jobs";

const SESSION_JOB_KINDS: ReadonlySet<string> = new Set<SessionJobKind>([
  "vote_due_24h",
  "vote_due_2h",
  "court_lock",
  "day_morning",
  "day_3h",
]);

export const isSessionJobKind = (kind: string): kind is SessionJobKind =>
  SESSION_JOB_KINDS.has(kind);

/** Buổi dưới 50% sức chứa thì admin được báo trước giờ khoá sân. */
const LOW_ATTENDANCE_RATIO = 0.5;

/**
 * Chạy một job theo buổi. Luôn đọc lại buổi: không còn, đã hủy/chốt, vân tay
 * (hoặc số giờ khoá sân) trong `jobKey` lệch với hiện tại, hay đã qua mốc liên
 * quan thì `"skipped"`, không gửi gì. Chỉ dùng `now` truyền vào, không dùng
 * đồng hồ thật. Caller đã kiểm công tắc (`gate`).
 */
export async function runSessionJob(
  db: DbOrTx,
  job: Pick<ScheduledJob, "jobKey" | "kind" | "sessionId">,
  now: Date,
  gate: boolean,
): Promise<"done" | "skipped"> {
  if (!isSessionJobKind(job.kind) || job.sessionId === null) return "skipped";
  const kind = job.kind;
  const sid = job.sessionId;

  const [row] = await db
    .select({
      date: sessions.date,
      startTime: sessions.startTime,
      status: sessions.status,
      voteDeadline: sessions.voteDeadline,
      maxPlayers: sessions.maxPlayers,
      adminGuestPlayCount: sessions.adminGuestPlayCount,
      courtName: courts.name,
      courtMapLink: courts.mapLink,
    })
    .from(sessions)
    .leftJoin(courts, eq(courts.id, sessions.courtId))
    .where(eq(sessions.id, sid))
    .limit(1);
  if (!row) return "skipped";
  const status = (row.status ?? "voting") as SessionStatus;
  if (status === "cancelled" || status === "completed") return "skipped";

  const startTime = row.startTime ?? DEFAULT_PLAY_START_TIME;
  const fp = sessionFingerprint({
    date: row.date,
    startTime,
    voteDeadline: row.voteDeadline,
  });
  if (!job.jobKey.endsWith(`:${fp}`)) return "skipped";
  if (now.getTime() >= sessionStartInstant(row.date, startTime).getTime()) {
    return "skipped";
  }

  const entity = { type: "session" as const, id: sid };
  const when = { sessionDate: row.date, startTime };
  const session = { status, voteDeadline: row.voteDeadline };

  if (kind === "vote_due_24h" || kind === "vote_due_2h") {
    // Hạn vote phải còn trong tương lai và vote còn mở (isVoteOpen kiểm cả hai).
    if (!row.voteDeadline || !isVoteOpen(session, now).open) return "skipped";
    const hoursLeft = kind === "vote_due_24h" ? 24 : 2;
    const notVoted = await sessionVoteRecipients(db, sid, "notVoted");
    await notify(db, {
      kind: "vote_due_soon",
      recipients: notVoted,
      payload: { ...when, hoursLeft },
      dedupBase: `vdue:s${sid}:${hoursLeft}h:${fp}`,
      entity,
      now,
      gate,
    });
    if (kind === "vote_due_2h" && notVoted.length > 0) {
      const names: string[] = [];
      for (const r of notVoted) names.push(await memberName(db, r.id));
      await notify(db, {
        kind: "unvoted_before_deadline",
        recipients: await superadminRecipients(db),
        payload: { ...when, names, voteDeadline: row.voteDeadline },
        dedupBase: `unvoted:s${sid}:${fp}`,
        entity,
        now,
        gate,
      });
    }
    return "done";
  }

  if (kind === "court_lock") {
    const hours = await courtLockHoursBefore(db);
    if (!new RegExp(`:h${hours}:`).test(job.jobKey)) return "skipped";
    const maxPlayers = row.maxPlayers ?? MAX_PLAY_SLOTS;
    const headcount = await currentHeadcount(db, sid, row.adminGuestPlayCount);
    if (headcount < maxPlayers * LOW_ATTENDANCE_RATIO) {
      await notify(db, {
        kind: "low_attendance",
        recipients: await superadminRecipients(db),
        payload: { ...when, headcount, maxPlayers },
        dedupBase: `courtlock:s${sid}:h${hours}:${fp}`,
        entity,
        now,
        gate,
      });
    }
    return "done";
  }

  const slot = kind === "day_morning" ? "morning" : "3h";
  await notify(db, {
    kind: "game_day_reminder",
    recipients: await sessionVoteRecipients(db, sid, "play"),
    payload: {
      ...when,
      when: slot,
      courtName: row.courtName ?? "",
      ...(row.courtMapLink ? { mapLink: row.courtMapLink } : {}),
    },
    dedupBase: `day:s${sid}:${slot}:${fp}`,
    entity,
    now,
    gate,
  });
  return "done";
}

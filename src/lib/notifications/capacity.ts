import { and, eq, gte, isNull, lt } from "drizzle-orm";
import {
  appSettings,
  members,
  notifications,
  sessions,
  votes,
} from "@/db/schema";
import type { DbOrTx } from "@/db/tx";
import { resolveGlobal } from "@/lib/settings-resolve";
import { isVoteOpen, type SessionStatus } from "@/lib/session-status";
import { MAX_PLAY_SLOTS, playHeadcount } from "@/lib/vote-capacity";
import {
  DEFAULT_PLAY_START_TIME,
  parseVoteDeadline,
} from "@/lib/vote-deadline";
import { isNotificationsEnabled, notify } from "./notify";
import {
  memberName,
  sessionVoteRecipients,
  superadminRecipients,
} from "./recipients";
import { sessionStartInstant } from "./time";

/**
 * Bậc sức chứa (spec 4.3): 0 = còn rộng, 1 = sắp đầy (còn 1-2 chỗ), 2 = đầy,
 * từ 3 trở đi mỗi 2 người vượt thêm một bậc (17/16 và 18/16 là 3, 19/16 là 4).
 * Admin chỉ nhận tin khi bậc tăng, nên dao động quanh ngưỡng không gửi lại.
 * "Sắp đầy" cần ít nhất 1 người: sân 1-2 chỗ chưa ai vote thì vẫn là còn rộng.
 */
export function capacityRank(headcount: number, maxPlayers: number): number {
  if (headcount > maxPlayers) {
    return 3 + Math.floor((headcount - maxPlayers - 1) / 2);
  }
  if (headcount === maxPlayers) return 2;
  if (headcount >= 1 && headcount >= maxPlayers - 2) return 1;
  return 0;
}

/**
 * Mốc admin phải quyết giữ hay trả sân: `hoursBefore` giờ trước giờ chơi. Nếu
 * hạn vote muộn hơn mốc đó thì đợi hết hạn vote mới biết đủ người (spec 4.3).
 */
export function courtLockAt(
  session: { date: string; startTime: string; voteDeadline: string | null },
  hoursBefore: number,
): Date {
  const lock = new Date(
    sessionStartInstant(session.date, session.startTime).getTime() -
      hoursBefore * 3_600_000,
  );
  if (!session.voteDeadline) return lock;
  const deadline = parseVoteDeadline(session.voteDeadline);
  return deadline > lock ? deadline : lock;
}

/** Công tắc: `gate` do action đọc sẵn; không truyền thì tự đọc 1 lần. */
async function enabled(db: DbOrTx, gate?: boolean): Promise<boolean> {
  if (gate !== undefined) return gate;
  return isNotificationsEnabled(db);
}

async function loadSession(db: DbOrTx, sessionId: number) {
  const [row] = await db
    .select({
      date: sessions.date,
      startTime: sessions.startTime,
      status: sessions.status,
      voteDeadline: sessions.voteDeadline,
      maxPlayers: sessions.maxPlayers,
      adminGuestPlayCount: sessions.adminGuestPlayCount,
    })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (!row) return undefined;
  return {
    ...row,
    startTime: row.startTime ?? DEFAULT_PLAY_START_TIME,
    status: (row.status ?? "voting") as SessionStatus,
    maxPlayers: row.maxPlayers ?? MAX_PLAY_SLOTS,
  };
}

/**
 * Số người chơi đang tính sức chứa: chỉ vote của member đang hoạt động và đã
 * duyệt (giống chặn sức chứa ở `submitVote`), cộng khách của admin.
 */
async function currentHeadcount(
  db: DbOrTx,
  sessionId: number,
  adminGuestPlayCount: number | null,
): Promise<number> {
  const rows = await db
    .select({
      willPlay: votes.willPlay,
      willDine: votes.willDine,
      withPartner: votes.withPartner,
      guestPlayCount: votes.guestPlayCount,
      guestDineCount: votes.guestDineCount,
    })
    .from(votes)
    .innerJoin(members, eq(members.id, votes.memberId))
    .where(
      and(
        eq(votes.sessionId, sessionId),
        eq(members.isActive, true),
        eq(members.approvalStatus, "approved"),
      ),
    );
  return playHeadcount(rows, adminGuestPlayCount ?? 0);
}

/**
 * Bậc cao nhất đã gửi cho (buổi, sức chứa). Truy vấn khoảng trên index unique
 * của `dedup_key`: ';' đứng ngay sau ':' trong bảng mã, nên khoảng này gồm mọi
 * khoá `cap:s{sid}:x{max}:...` (kể cả hậu tố người nhận `:a{id}`) mà không
 * dính `x{max}0`.
 */
async function highestSentRank(
  db: DbOrTx,
  sessionId: number,
  maxPlayers: number,
): Promise<number> {
  const prefix = `cap:s${sessionId}:x${maxPlayers}`;
  const rows = await db
    .select({ dedupKey: notifications.dedupKey })
    .from(notifications)
    .where(
      and(
        gte(notifications.dedupKey, `${prefix}:`),
        lt(notifications.dedupKey, `${prefix};`),
      ),
    );
  let best = 0;
  for (const r of rows) {
    const m = /^cap:s\d+:x\d+:r(\d+)(?::|$)/.exec(r.dedupKey);
    if (m) best = Math.max(best, Number(m[1]));
  }
  return best;
}

async function courtLockHoursBefore(db: DbOrTx): Promise<number> {
  const rows = await db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, "courtLockHoursBefore"))
    .limit(1);
  return resolveGlobal(rows).courtLockHoursBefore;
}

const sessionEntity = (id: number) => ({ type: "session" as const, id });

/**
 * Gọi trong transaction ngay sau mọi lệnh ghi làm đổi số người chơi hoặc sức
 * chứa. Admin nhận `capacity_alert` khi bậc vượt bậc cao nhất đã gửi cho sức
 * chứa hiện tại (đổi sức chứa là bắt đầu lại từ đầu). Member chưa vote nhận
 * "sắp đầy" một lần khi còn 1-2 chỗ và vote đang mở.
 */
export async function evaluateCapacity(
  db: DbOrTx,
  sessionId: number,
  now: Date = new Date(),
  gate?: boolean,
): Promise<void> {
  if (!(await enabled(db, gate))) return;
  const s = await loadSession(db, sessionId);
  if (!s) return;
  if (s.status !== "voting" && s.status !== "confirmed") return;

  const headcount = await currentHeadcount(
    db,
    sessionId,
    s.adminGuestPlayCount,
  );
  const rank = capacityRank(headcount, s.maxPlayers);
  if (rank === 0) return;

  if (rank > (await highestSentRank(db, sessionId, s.maxPlayers))) {
    const hours = await courtLockHoursBefore(db);
    await notify(db, {
      kind: "capacity_alert",
      recipients: await superadminRecipients(db),
      payload: {
        sessionDate: s.date,
        startTime: s.startTime,
        rank,
        headcount,
        maxPlayers: s.maxPlayers,
        courtLockAt: courtLockAt(s, hours).toISOString(),
      },
      dedupBase: `cap:s${sessionId}:x${s.maxPlayers}:r${rank}`,
      entity: sessionEntity(sessionId),
      now,
    });
  }

  if (rank === 1 && isVoteOpen(s, now).open) {
    await notify(db, {
      kind: "session_almost_full",
      recipients: await sessionVoteRecipients(db, sessionId, "notVoted"),
      payload: { sessionDate: s.date, startTime: s.startTime },
      dedupBase: `salmost:s${sessionId}:x${s.maxPlayers}`,
      entity: sessionEntity(sessionId),
      now,
    });
  }
}

/** Bỏ chơi trong khoảng này trước giờ bắt đầu thì báo admin. */
const LATE_DROPOUT_WINDOW_MS = 24 * 3_600_000;

/**
 * Member vừa bỏ chơi (willPlay true thành false, hoặc xoá vote). Caller tự so
 * vote cũ và mới; hàm này chỉ xét giờ: trước giờ bắt đầu và trong 24 giờ cuối.
 * Gọi SAU lệnh ghi để số người còn lại là số mới.
 */
export async function notifyLateDropout(
  db: DbOrTx,
  sessionId: number,
  memberId: number,
  token: string,
  now: Date = new Date(),
  gate?: boolean,
): Promise<void> {
  if (!(await enabled(db, gate))) return;
  const s = await loadSession(db, sessionId);
  if (!s) return;
  const startsIn =
    sessionStartInstant(s.date, s.startTime).getTime() - now.getTime();
  if (startsIn <= 0 || startsIn > LATE_DROPOUT_WINDOW_MS) return;
  await notify(db, {
    kind: "member_dropped_late",
    recipients: await superadminRecipients(db),
    payload: {
      sessionDate: s.date,
      startTime: s.startTime,
      memberName: await memberName(db, memberId),
      headcount: await currentHeadcount(db, sessionId, s.adminGuestPlayCount),
      maxPlayers: s.maxPlayers,
    },
    dedupBase: `drop:s${sessionId}:m${memberId}:${token}`,
    entity: sessionEntity(sessionId),
    now,
  });
}

/** Phần vote member thấy trong tin "admin sửa vote"; `null` = chưa có vote. */
export type AdminEditedVote = {
  willPlay: boolean;
  willDine: boolean;
  withPartner: boolean;
  guestPlayCount: number;
  guestDineCount: number;
} | null;

/**
 * Đọc vote của member theo đúng các trường có trong tin. Action gọi trước lệnh
 * ghi (chỉ khi công tắc bật) để so với vote sau khi ghi.
 */
export async function readAdminEditedVote(
  db: DbOrTx,
  sessionId: number,
  memberId: number,
): Promise<AdminEditedVote> {
  const [v] = await db
    .select({
      willPlay: votes.willPlay,
      willDine: votes.willDine,
      withPartner: votes.withPartner,
      guestPlayCount: votes.guestPlayCount,
      guestDineCount: votes.guestDineCount,
    })
    .from(votes)
    .where(and(eq(votes.sessionId, sessionId), eq(votes.memberId, memberId)))
    .limit(1);
  if (!v) return null;
  return {
    willPlay: v.willPlay ?? false,
    willDine: v.willDine ?? false,
    withPartner: v.withPartner ?? false,
    guestPlayCount: v.guestPlayCount ?? 0,
    guestDineCount: v.guestDineCount ?? 0,
  };
}

function sameVote(a: AdminEditedVote, b: AdminEditedVote): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.willPlay === b.willPlay &&
    a.willDine === b.willDine &&
    a.withPartner === b.withPartner &&
    a.guestPlayCount === b.guestPlayCount &&
    a.guestDineCount === b.guestDineCount
  );
}

/**
 * Admin vừa sửa vote của member: gửi cho chính member đó vote mới của họ (chỉ
 * dữ liệu của họ). Gọi SAU lệnh ghi với `previous` đọc TRƯỚC lệnh ghi.
 *
 * Màn admin gọi một action cho mỗi lần bấm (stepper khách bấm 3 lần là 3 lần
 * ghi), mà tin này bắt buộc nên member không tắt được. Vì vậy:
 * - vote sau khi ghi giống hệt trước (so trên các trường của tin) thì không gửi;
 * - member còn một tin này CHƯA ĐỌC cho cùng buổi thì sửa nội dung và đẩy
 *   `created_at` của dòng đó lên, không thêm dòng. Đọc rồi thì lần sửa sau ra
 *   dòng mới với token mới, nên dedup vẫn là "một tin cho một lần member cần
 *   biết". Dòng gộp giữ nguyên `dedup_key` của lần đầu.
 * Không còn dòng vote nghĩa là đã bị xoá, gửi tất cả false.
 */
export async function notifyVoteEditedByAdmin(
  db: DbOrTx,
  sessionId: number,
  memberId: number,
  token: string,
  previous: AdminEditedVote,
  gate?: boolean,
  now: Date = new Date(),
): Promise<void> {
  if (!(await enabled(db, gate))) return;
  const current = await readAdminEditedVote(db, sessionId, memberId);
  if (sameVote(previous, current)) return;
  const s = await loadSession(db, sessionId);
  if (!s) return;
  const payload = {
    sessionDate: s.date,
    startTime: s.startTime,
    willPlay: current?.willPlay ?? false,
    willDine: current?.willDine ?? false,
    withPartner: current?.withPartner ?? false,
    guestPlayCount: current?.guestPlayCount ?? 0,
    guestDineCount: current?.guestDineCount ?? 0,
  };

  // Khoảng trên index unique của dedup_key, như `highestSentRank`: gồm mọi
  // khoá `vedit:s{sid}:m{mid}:...` mà không dính `m{mid}0`.
  const prefix = `vedit:s${sessionId}:m${memberId}`;
  const [unread] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        gte(notifications.dedupKey, `${prefix}:`),
        lt(notifications.dedupKey, `${prefix};`),
        isNull(notifications.readAt),
      ),
    )
    .limit(1);
  if (unread) {
    await db
      .update(notifications)
      .set({ payload, createdAt: now.toISOString() })
      .where(eq(notifications.id, unread.id));
    return;
  }

  await notify(db, {
    kind: "vote_edited_by_admin",
    recipients: [{ type: "member", id: memberId }],
    payload,
    dedupBase: `${prefix}:${token}`,
    entity: sessionEntity(sessionId),
    now,
    gate: true,
  });
}

import "server-only";
import { and, asc, eq, ne, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import {
  courts,
  exchangeEvents,
  exchangeRegistrations,
  members,
  sessionAttendees,
  sessions,
} from "@/db/schema";
import type { DbOrTx } from "@/db/tx";
import {
  FEEDBACK_MAX_PEERS,
  FEEDBACK_WINDOW_DAYS,
  WEIGHT_FULL_AT,
} from "./constants";
import { feedbackWindow, weight5, windowClosed } from "./score";

/**
 * Điểm danh hợp lệ (Global Constraints G2d): đăng ký `approved` có
 * `checked_in = 1` ở buổi không ẩn, không huỷ. `status = 'approved'` loại đăng
 * ký bị huỷ do gộp tài khoản mà vẫn giữ cờ điểm danh (I4). Nhận cột thay vì
 * bảng để dùng được với alias.
 */
export function validCheckInSql(
  reg: { checkedIn: SQLWrapper; status: SQLWrapper },
  ev: { hiddenAt: SQLWrapper; status: SQLWrapper },
): SQL {
  return sql`(${reg.checkedIn} = 1 AND ${reg.status} = 'approved' AND ${ev.hiddenAt} IS NULL AND ${ev.status} <> 'cancelled')`;
}

/**
 * Hai truy vấn đếm "số buổi đã đến" cho trọng số, mỗi truy vấn dừng ở
 * `WEIGHT_FULL_AT` dòng vì trọng số không tăng thêm (quota Turso tính theo dòng
 * đọc). Nhánh giao lưu đi theo `exchange_registrations(member_id, checked_in)`,
 * nhánh nhóm theo `session_attendees(member_id)`; bảng buổi tra theo khoá chính.
 * Hai câu phẳng thay vì một câu `COUNT` bọc subquery để kế hoạch truy vấn chỉ có
 * SEARCH (test EXPLAIN QUERY PLAN).
 */
export function raterWeightQueries(memberId: number): [SQL, SQL] {
  const r = exchangeRegistrations;
  const e = exchangeEvents;
  const sa = sessionAttendees;
  const s = sessions;
  return [
    sql`SELECT 1 AS one FROM ${r} INNER JOIN ${e} ON ${e.id} = ${r.eventId}
      WHERE ${r.memberId} = ${memberId} AND ${validCheckInSql(r, e)}
      LIMIT ${WEIGHT_FULL_AT}`,
    sql`SELECT 1 AS one FROM ${sa} INNER JOIN ${s} ON ${s.id} = ${sa.sessionId}
      WHERE ${sa.memberId} = ${memberId} AND ${sa.isGuest} = 0
        AND ${sa.attendsPlay} = 1 AND ${s.status} = 'completed'
      LIMIT ${WEIGHT_FULL_AT}`,
  ];
}

/**
 * Trọng số người chấm (0..5, đơn vị 1/5 lượt): điểm danh hợp lệ ở buổi giao
 * lưu cộng buổi nhóm đã chốt có chơi (quyết định 2). Chụp vào `rater_weight`
 * lúc ghi (quyết định 1).
 */
export async function raterWeight5(
  db: DbOrTx,
  memberId: number,
): Promise<number> {
  const [exchange, group] = raterWeightQueries(memberId);
  const a = await db.all<{ one: number }>(exchange);
  const b = await db.all<{ one: number }>(group);
  return weight5(a.length + b.length);
}

/**
 * Người "đã quen" khi đếm báo cáo (như G2c): member `approved`, hoặc có ít
 * nhất một đăng ký `checked_in = 1`. Alias riêng để không đụng tên bảng của
 * truy vấn ngoài.
 */
export function establishedMemberSql(
  memberId: SQLWrapper,
  approvalStatus: SQLWrapper,
): SQL {
  return sql`(${approvalStatus} = 'approved' OR EXISTS (SELECT 1 FROM exchange_registrations est_r WHERE est_r.member_id = ${memberId} AND est_r.checked_in = 1))`;
}

export type FeedbackPeer = {
  registrationId: number;
  memberId: number;
  name: string;
  avatarUrl: string | null;
  avatarKey: string | null;
  code: string | null;
};

export type FeedbackContext = {
  event: {
    id: number;
    publicCode: string;
    title: string;
    hostMemberId: number;
    endAt: string;
  };
  host: {
    name: string;
    avatarUrl: string | null;
    avatarKey: string | null;
    code: string | null;
  };
  state: "notYet" | "open" | "closed";
  closesAt: string;
  myRegistrationId: number | null;
  peers: FeedbackPeer[];
};

const WINDOW_MS = FEEDBACK_WINDOW_DAYS * 86_400_000;

/**
 * Bối cảnh phiếu chấm của một buổi theo mã. `null` khi không có buổi, buổi ẩn
 * hoặc huỷ. Đúng mốc `endAt + 7 ngày` đã là `closed`: lúc đó lượt chấm bắt đầu
 * được cộng (`windowClosed`), nên không lần ghi nào được lọt vào cửa sổ đã tổng
 * hợp. Host không chấm người chơi buổi mình mở và không bao giờ là peer
 * (quyết định 4); người xem không có điểm danh hợp lệ thì không thấy ai. Peer
 * bị khoá hoặc bị từ chối không có trong danh sách.
 */
export async function loadFeedbackContext(
  db: DbOrTx,
  code: string,
  viewerId: number,
  now: Date,
): Promise<FeedbackContext | null> {
  const [ev] = await db
    .select({
      id: exchangeEvents.id,
      publicCode: exchangeEvents.publicCode,
      title: exchangeEvents.title,
      hostMemberId: exchangeEvents.hostMemberId,
      endAt: exchangeEvents.endAt,
      status: exchangeEvents.status,
      hiddenAt: exchangeEvents.hiddenAt,
      hostName: members.name,
      hostAvatarUrl: members.avatarUrl,
      hostAvatarKey: members.avatarKey,
      hostCode: members.publicCode,
    })
    .from(exchangeEvents)
    .innerJoin(members, eq(members.id, exchangeEvents.hostMemberId))
    .where(eq(exchangeEvents.publicCode, code))
    .limit(1);
  if (!ev || ev.hiddenAt !== null || ev.status === "cancelled") return null;

  const state = windowClosed(ev.endAt, now)
    ? "closed"
    : feedbackWindow(ev.endAt, now);

  const base = {
    event: {
      id: ev.id,
      publicCode: ev.publicCode,
      title: ev.title,
      hostMemberId: ev.hostMemberId,
      endAt: ev.endAt,
    },
    host: {
      name: ev.hostName,
      avatarUrl: ev.hostAvatarUrl,
      avatarKey: ev.hostAvatarKey,
      code: ev.hostCode,
    },
    state,
    closesAt: new Date(Date.parse(ev.endAt) + WINDOW_MS).toISOString(),
  } satisfies Omit<FeedbackContext, "myRegistrationId" | "peers">;

  if (viewerId === ev.hostMemberId) {
    return { ...base, myRegistrationId: null, peers: [] };
  }

  const [mine] = await db
    .select({ id: exchangeRegistrations.id })
    .from(exchangeRegistrations)
    .where(
      and(
        eq(exchangeRegistrations.eventId, ev.id),
        eq(exchangeRegistrations.memberId, viewerId),
        eq(exchangeRegistrations.checkedIn, true),
        eq(exchangeRegistrations.status, "approved"),
      ),
    )
    .limit(1);
  if (!mine) return { ...base, myRegistrationId: null, peers: [] };

  const peers = await db
    .select({
      registrationId: exchangeRegistrations.id,
      memberId: exchangeRegistrations.memberId,
      name: members.name,
      avatarUrl: members.avatarUrl,
      avatarKey: members.avatarKey,
      code: members.publicCode,
    })
    .from(exchangeRegistrations)
    .innerJoin(members, eq(members.id, exchangeRegistrations.memberId))
    .where(
      and(
        eq(exchangeRegistrations.eventId, ev.id),
        eq(exchangeRegistrations.checkedIn, true),
        eq(exchangeRegistrations.status, "approved"),
        ne(exchangeRegistrations.memberId, viewerId),
        ne(exchangeRegistrations.memberId, ev.hostMemberId),
        // Nick bị khoá hoặc bị từ chối không chấm được (lượt của họ không
        // tính) nên cũng không được chấm: phiếu không hiện, action từ chối.
        eq(members.isActive, true),
        ne(members.approvalStatus, "rejected"),
      ),
    )
    .orderBy(asc(exchangeRegistrations.id))
    .limit(FEEDBACK_MAX_PEERS);

  return { ...base, myRegistrationId: mine.id, peers };
}

/**
 * Người được đánh giá sân: có điểm danh hợp lệ ở buổi giao lưu của sân đó, hoặc
 * đã chơi (không phải khách) ở buổi nhóm đã chốt tại sân của nhóm nối với sân
 * đó (`courts.venue_id`).
 */
export async function venueReviewEligible(
  db: DbOrTx,
  venueId: number,
  memberId: number,
): Promise<boolean> {
  const r = exchangeRegistrations;
  const e = exchangeEvents;
  const sa = sessionAttendees;
  const s = sessions;
  const c = courts;
  const [row] = await db.all<{ ok: number }>(sql`SELECT
    EXISTS (SELECT 1 FROM ${r} INNER JOIN ${e} ON ${e.id} = ${r.eventId}
      WHERE ${r.memberId} = ${memberId} AND ${e.venueId} = ${venueId}
        AND ${validCheckInSql(r, e)})
    OR EXISTS (SELECT 1 FROM ${sa}
      INNER JOIN ${s} ON ${s.id} = ${sa.sessionId}
      INNER JOIN ${c} ON ${c.id} = ${s.courtId}
      WHERE ${sa.memberId} = ${memberId} AND ${sa.isGuest} = 0
        AND ${sa.attendsPlay} = 1 AND ${s.status} = 'completed'
        AND ${c.venueId} = ${venueId}) AS ok`);
  return Number(row?.ok ?? 0) === 1;
}

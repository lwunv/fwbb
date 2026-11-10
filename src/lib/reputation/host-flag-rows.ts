import "server-only";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { exchangeEvents, exchangeRegistrations, members } from "@/db/schema";
import type { DbOrTx } from "@/db/tx";
import { EXCHANGE_EVENT_STATUSES } from "@/lib/exchange/constants";
import { HOST_FLAG_ROW_CAP } from "./constants";
import { validCheckInSql } from "./eligibility";

/**
 * Mọi trạng thái buổi trừ `cancelled`, viết thành `status IN (...)` thay vì
 * `<> 'cancelled'`: SQLite chỉ dùng được index `exchange_events_status_start_idx`
 * (status, start_at) khi `status` so bằng hoặc IN. Với `<>` nó quét toàn bộ
 * `exchange_registrations`; LIMIT chỉ cắt số dòng trả về, không cắt số dòng
 * đọc, mà quota Turso tính theo dòng đọc.
 */
const LIVE_EVENT_STATUSES = EXCHANGE_EVENT_STATUSES.filter(
  (s) => s !== "cancelled",
);

/**
 * Điểm danh hợp lệ ở các buổi bắt đầu từ `since`, mới trước, tối đa
 * `HOST_FLAG_ROW_CAP` dòng (đầu vào của `findCaptiveHosts`). Tách khỏi file
 * action để test EXPLAIN QUERY PLAN đọc được đúng câu truy vấn.
 */
export function hostFlagRowsQuery(db: DbOrTx, since: string) {
  return db
    .select({
      hostId: exchangeEvents.hostMemberId,
      eventId: exchangeEvents.id,
      memberId: exchangeRegistrations.memberId,
      approvalStatus: members.approvalStatus,
    })
    .from(exchangeRegistrations)
    .innerJoin(
      exchangeEvents,
      eq(exchangeEvents.id, exchangeRegistrations.eventId),
    )
    .innerJoin(members, eq(members.id, exchangeRegistrations.memberId))
    .where(
      and(
        validCheckInSql(exchangeRegistrations, exchangeEvents),
        inArray(exchangeEvents.status, LIVE_EVENT_STATUSES),
        gte(exchangeEvents.startAt, since),
      ),
    )
    .orderBy(desc(exchangeEvents.startAt))
    .limit(HOST_FLAG_ROW_CAP);
}

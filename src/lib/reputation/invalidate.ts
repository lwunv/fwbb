import "server-only";
import { updateTag } from "next/cache";
import { eq, inArray, sql } from "drizzle-orm";
import {
  exchangeEvents,
  hostFeedback,
  peerFeedback,
  venueReviews,
} from "@/db/schema";
import type { DbOrTx } from "@/db/tx";
import { VENUE_REVIEWS_TAG, repTag, venueReviewTag } from "./constants";

/**
 * Trần số tag làm mới theo người chấm. Mỗi lần đọc theo index
 * (`*_from_idx`, `venue_reviews_member_idx`); vượt trần thì phần còn lại tự
 * hết hạn theo `PROFILE_REVALIDATE_S` thay vì quét cả bảng.
 */
export const FANOUT_CAP = 500;

/** Sân member đã đánh giá, kèm cờ có đánh giá đang hiện (`venue_reviews_member_idx`). */
export function reviewedVenuesQuery(db: DbOrTx, ids: number[]) {
  return db
    .select({
      venueId: venueReviews.venueId,
      visible: sql<number>`MAX(${venueReviews.status} = 'visible')`,
    })
    .from(venueReviews)
    .where(inArray(venueReviews.memberId, ids))
    .groupBy(venueReviews.venueId)
    .limit(FANOUT_CAP);
}

/** Người member đã chấm (`peer_feedback_from_idx`). */
export function ratedMembersQuery(db: DbOrTx, ids: number[]) {
  return db
    .selectDistinct({ id: peerFeedback.toMemberId })
    .from(peerFeedback)
    .where(inArray(peerFeedback.fromMemberId, ids))
    .limit(FANOUT_CAP);
}

/** Host các buổi member đã chấm (`host_feedback_from_idx` + PK buổi). */
export function ratedHostsQuery(db: DbOrTx, ids: number[]) {
  return db
    .selectDistinct({ id: exchangeEvents.hostMemberId })
    .from(hostFeedback)
    .innerJoin(exchangeEvents, eq(exchangeEvents.id, hostFeedback.eventId))
    .where(inArray(hostFeedback.fromMemberId, ids))
    .limit(FANOUT_CAP);
}

export type InvalidateOptions = {
  /**
   * Trạng thái tài khoản đổi (khoá, mở khoá, từ chối, duyệt, gộp): lượt chấm
   * của họ được cộng hay không đổi theo, nên làm mới cả người họ đã chấm, host
   * các buổi họ chấm, và trung bình chung mọi sân nếu họ có đánh giá đang hiện.
   */
  asRater?: boolean;
  /** Gộp: mã hồ sơ của nguồn đổi chủ, xoá cache mã → id (tag "exchange"). */
  codes?: boolean;
  /**
   * Người được chấm có dòng chấm vừa bị xoá trong lúc gộp: sau commit không
   * còn dòng nào nối họ với người gộp, nên fan-out không tìm thấy họ. Chỉ làm
   * mới hồ sơ của họ.
   */
  rated?: number[];
};

/**
 * Làm mới cache hồ sơ và uy tín sau khi sửa member. Gọi SAU commit: các truy
 * vấn ở đây đọc trạng thái mới (sau gộp, dòng của nguồn đã nằm ở đích).
 */
export async function invalidateMemberReputation(
  db: DbOrTx,
  memberIds: number[],
  opts: InvalidateOptions = {},
): Promise<void> {
  const ids = [...new Set(memberIds)];
  if (ids.length === 0) return;
  const tags = new Set(ids.map(repTag));

  for (const id of opts.rated ?? []) tags.add(repTag(id));

  const reviewed = await reviewedVenuesQuery(db, ids);
  for (const r of reviewed) tags.add(venueReviewTag(r.venueId));

  if (opts.asRater) {
    if (reviewed.some((r) => Number(r.visible) === 1)) {
      tags.add(VENUE_REVIEWS_TAG);
    }
    const [rated, hosts] = await Promise.all([
      ratedMembersQuery(db, ids),
      ratedHostsQuery(db, ids),
    ]);
    for (const r of rated) tags.add(repTag(r.id));
    for (const h of hosts) tags.add(repTag(h.id));
  }

  if (opts.codes) tags.add("exchange");
  for (const tag of tags) updateTag(tag);
}

/**
 * Làm mới cache sau khi gộp member. Người gọi gọi hàm này SAU commit và SAU các
 * `revalidatePath`: lần gộp đã ghi xong, nên lỗi cache không được biến nó thành
 * "thất bại" hay bỏ qua bước làm mới trang quỹ. Làm mới ở đây chỉ là cố gắng
 * tốt nhất: tag nào sót sẽ tự hết hạn sau `PROFILE_REVALIDATE_S` (600 giây).
 * Log chỉ id, không tên, không nội dung lỗi.
 */
export async function invalidateAfterMerge(
  db: DbOrTx,
  sourceId: number,
  targetId: number,
  rated: number[],
): Promise<void> {
  try {
    await invalidateMemberReputation(db, [sourceId, targetId], {
      asRater: true,
      codes: true,
      rated,
    });
  } catch {
    console.error("[Reputation] merge-invalidate-failed", {
      sourceId,
      targetId,
    });
  }
}

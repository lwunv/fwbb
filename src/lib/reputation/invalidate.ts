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
const FANOUT_CAP = 500;

export type InvalidateOptions = {
  /**
   * Trạng thái tài khoản đổi (khoá, mở khoá, từ chối, duyệt, gộp): lượt chấm
   * của họ được cộng hay không đổi theo, nên làm mới cả người họ đã chấm, host
   * các buổi họ chấm, và trung bình chung mọi sân nếu họ có đánh giá đang hiện.
   */
  asRater?: boolean;
  /** Gộp: mã hồ sơ của nguồn đổi chủ, xoá cache mã → id (tag "exchange"). */
  codes?: boolean;
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

  const reviewed = await db
    .select({
      venueId: venueReviews.venueId,
      visible: sql<number>`MAX(${venueReviews.status} = 'visible')`,
    })
    .from(venueReviews)
    .where(inArray(venueReviews.memberId, ids))
    .groupBy(venueReviews.venueId)
    .limit(FANOUT_CAP);
  for (const r of reviewed) tags.add(venueReviewTag(r.venueId));

  if (opts.asRater) {
    if (reviewed.some((r) => Number(r.visible) === 1)) {
      tags.add(VENUE_REVIEWS_TAG);
    }
    const [rated, hosts] = await Promise.all([
      db
        .selectDistinct({ id: peerFeedback.toMemberId })
        .from(peerFeedback)
        .where(inArray(peerFeedback.fromMemberId, ids))
        .limit(FANOUT_CAP),
      db
        .selectDistinct({ id: exchangeEvents.hostMemberId })
        .from(hostFeedback)
        .innerJoin(exchangeEvents, eq(exchangeEvents.id, hostFeedback.eventId))
        .where(inArray(hostFeedback.fromMemberId, ids))
        .limit(FANOUT_CAP),
    ]);
    for (const r of rated) tags.add(repTag(r.id));
    for (const h of hosts) tags.add(repTag(h.id));
  }

  if (opts.codes) tags.add("exchange");
  for (const tag of tags) updateTag(tag);
}

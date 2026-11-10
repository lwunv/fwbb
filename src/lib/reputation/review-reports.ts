import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { abuseReports, members, venueReviews } from "@/db/schema";
import type { DbOrTx } from "@/db/tx";
import { establishedMemberSql } from "./eligibility";

/**
 * Đếm lại báo cáo `open` của người "đã quen" nhắm vào một đánh giá sân và ghi
 * vào `report_count` (quyết định 29). Đếm lại từ nguồn thay vì cộng trừ, nên
 * báo trùng, báo đồng thời hay admin đóng báo cáo đều hội tụ về cùng một số.
 * Không đổi `status`: tự ẩn là việc của người gọi khi có báo cáo mới, còn bỏ
 * ẩn chỉ ở tab Uy tín.
 */
export async function syncReviewReportCount(
  tx: DbOrTx,
  reviewId: number,
): Promise<number> {
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)` })
    .from(abuseReports)
    .innerJoin(members, eq(members.id, abuseReports.reporterMemberId))
    .where(
      and(
        eq(abuseReports.targetType, "review"),
        eq(abuseReports.targetId, reviewId),
        eq(abuseReports.status, "open"),
        establishedMemberSql(members.id, members.approvalStatus),
      ),
    );
  const count = Number(n);
  await tx
    .update(venueReviews)
    .set({ reportCount: count })
    .where(eq(venueReviews.id, reviewId));
  return count;
}

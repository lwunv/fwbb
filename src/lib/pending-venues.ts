import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { venues } from "@/db/schema";

/**
 * Số sân thành viên đề xuất đang chờ admin duyệt, hiện trên khung admin. Chỉ
 * layout admin (đã qua cổng đăng nhập admin) gọi; `status` đứng đầu index
 * `venues_status_lat_lng_idx` nên đây là một COUNT có index.
 */
export async function countPendingVenues(): Promise<number> {
  const rows = await db
    .select({ c: sql<number>`count(*)` })
    .from(venues)
    .where(eq(venues.status, "pending"));
  return Number(rows[0]?.c ?? 0);
}

import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { exchangeEvents, exchangeRegistrations, referrals } from "@/db/schema";
import type { DbOrTx } from "@/db/tx";
import { referralBrokenAt } from "./referral-rules";

// Tách khỏi `referral.ts` vì `src/lib/exchange/attendance.ts` cần
// `hasActiveReferral`: file này chỉ nhận `db`/`tx` qua tham số, không kéo
// `@/db` hay cache của `profile-read` vào mọi chỗ import giới hạn nick mới.

/**
 * Mốc vắng và huỷ muộn của các nick được giới thiệu (quyết định 43): vắng tính
 * theo giờ bắt đầu buổi, huỷ muộn theo giờ huỷ; buổi bị huỷ không tính. Một
 * truy vấn theo index `exchange_registrations(member_id, ...)`.
 */
export async function referralIncidents(
  db: DbOrTx,
  refereeIds: number[],
): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  const ids = [...new Set(refereeIds)];
  if (ids.length === 0) return out;
  const rows = await db
    .select({
      memberId: exchangeRegistrations.memberId,
      at: sql<
        string | null
      >`CASE WHEN ${exchangeRegistrations.status} = 'no_show' THEN ${exchangeEvents.startAt} ELSE ${exchangeRegistrations.cancelledAt} END`,
    })
    .from(exchangeRegistrations)
    .innerJoin(
      exchangeEvents,
      eq(exchangeEvents.id, exchangeRegistrations.eventId),
    )
    .where(
      and(
        inArray(exchangeRegistrations.memberId, ids),
        inArray(exchangeRegistrations.status, ["no_show", "late_cancelled"]),
        sql`${exchangeEvents.status} <> 'cancelled'`,
      ),
    );
  for (const r of rows) {
    if (!r.at) continue;
    const list = out.get(r.memberId) ?? [];
    list.push(r.at);
    out.set(r.memberId, list);
  }
  return out;
}

/**
 * Nick này đang được giới thiệu và lời giới thiệu chưa bị phá (quyết định 44,
 * 45). Không có dòng giới thiệu thì không đọc thêm gì.
 */
export async function hasActiveReferral(
  db: DbOrTx,
  refereeId: number,
  now: Date,
): Promise<boolean> {
  const [row] = await db
    .select({ createdAt: referrals.createdAt })
    .from(referrals)
    .where(eq(referrals.refereeMemberId, refereeId))
    .limit(1);
  if (!row) return false;
  const incidents = (await referralIncidents(db, [refereeId])).get(refereeId);
  const broken = referralBrokenAt(row.createdAt, incidents ?? []);
  return broken === null || Date.parse(broken) > now.getTime();
}

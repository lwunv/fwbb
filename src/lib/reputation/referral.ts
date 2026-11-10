import "server-only";
import { and, eq, gte } from "drizzle-orm";
import { referrals } from "@/db/schema";
import type { DbOrTx } from "@/db/tx";
import { REFERRAL_BLOCK_DAYS, REFERRAL_WATCH_DAYS } from "./constants";
import { raterWeight5 } from "./eligibility";
import { attendanceSummaries } from "./profile-read";
import {
  canRefer,
  referralBrokenAt,
  referrerBlockedUntil,
  vnMonthBounds,
} from "./referral-rules";
import { referralIncidents } from "./referral-status";

export { hasActiveReferral, referralIncidents } from "./referral-status";

const DAY_MS = 86_400_000;
/**
 * Lời giới thiệu cũ hơn mốc này không còn khoá được ai: bị phá muộn nhất ở
 * ngày 30, khoá thêm 30 ngày. Cũng phủ trọn tháng lịch hiện tại (tối đa 31
 * ngày), nên một lần đọc đủ cho cả đếm tháng lẫn khoá.
 */
const LOOKBACK_MS = (REFERRAL_WATCH_DAYS + REFERRAL_BLOCK_DAYS) * DAY_MS;

/**
 * Quyền giới thiệu của một member lúc `now`. `eligible` chỉ là điều kiện buổi
 * đã đến (quyết định 40); khoá (quyết định 44) và số lượt tháng này (quyết
 * định 41, tính cả lượt đã bị phá) trả riêng để giao diện nói đúng lý do.
 */
export async function referrerState(
  db: DbOrTx,
  member: { id: number; approvalStatus: string },
  now: Date,
): Promise<{
  eligible: boolean;
  usedThisMonth: number;
  blockedUntil: string | null;
}> {
  const attendedTotal = await raterWeight5(db, member.id);
  const summary = (await attendanceSummaries(db, [member], now)).get(
    member.id,
  )!;
  const eligible = canRefer({
    attendedTotal,
    attended: summary.attended,
    approvedPast: summary.approvedPast,
  });

  const since = new Date(now.getTime() - LOOKBACK_MS).toISOString();
  const recent = await db
    .select({
      refereeId: referrals.refereeMemberId,
      createdAt: referrals.createdAt,
    })
    .from(referrals)
    .where(
      and(
        eq(referrals.referrerMemberId, member.id),
        gte(referrals.createdAt, since),
      ),
    );

  const { from, to } = vnMonthBounds(now);
  const usedThisMonth = recent.filter(
    (r) => r.createdAt >= from && r.createdAt < to,
  ).length;

  const incidents = await referralIncidents(
    db,
    recent.map((r) => r.refereeId),
  );
  const brokenAts = recent
    .map((r) => referralBrokenAt(r.createdAt, incidents.get(r.refereeId) ?? []))
    .filter((b): b is string => b !== null);

  return {
    eligible,
    usedThisMonth,
    blockedUntil: referrerBlockedUntil(brokenAts, now),
  };
}

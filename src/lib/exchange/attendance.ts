import "server-only";
import { and, eq, inArray, isNull, gt, sql } from "drizzle-orm";
import { exchangeEvents, exchangeRegistrations } from "@/db/schema";
import type { DbOrTx } from "@/db/tx";
import { hasActiveReferral } from "@/lib/reputation/referral-status";

/** Số buổi đã check-in và số đăng ký được duyệt của member (G2d dùng lại). */
export async function attendanceStats(
  tx: DbOrTx,
  memberId: number,
): Promise<{ checkedIn: number; approved: number }> {
  const [row] = await tx
    .select({
      checkedIn: sql<number>`COALESCE(SUM(CASE WHEN ${exchangeRegistrations.checkedIn} = 1 THEN 1 ELSE 0 END), 0)`,
      approved: sql<number>`COALESCE(SUM(CASE WHEN ${exchangeRegistrations.status} = 'approved' THEN 1 ELSE 0 END), 0)`,
    })
    .from(exchangeRegistrations)
    .where(eq(exchangeRegistrations.memberId, memberId));
  return { checkedIn: Number(row.checkedIn), approved: Number(row.approved) };
}

/**
 * Nick mới đang bị giới hạn (G2b, G2d quyết định 46): không `approved`, chưa
 * có đăng ký `checked_in = 1` nào, và không có lời giới thiệu còn hiệu lực.
 * Nhãn "Mới" vẫn theo định nghĩa G2b; hàm này chỉ quyết định giới hạn.
 */
export async function isLimitedNewAccount(
  tx: DbOrTx,
  member: { id: number; approvalStatus: string },
  now: Date,
): Promise<boolean> {
  if (member.approvalStatus === "approved") return false;
  if ((await attendanceStats(tx, member.id)).checkedIn > 0) return false;
  return !(await hasActiveReferral(tx, member.id, now));
}

/**
 * Giới hạn nick mới. Member `approved` của nhóm không bao giờ là nick mới; còn
 * lại là nick mới cho đến khi có ít nhất 1 lần check-in hoặc được giới thiệu
 * (G2d). `waitingCount` chỉ đếm đăng ký đang chờ của buổi còn mở (không huỷ,
 * không ẩn, chưa bắt đầu) để buổi đã qua không chặn oan người dùng.
 */
export async function newAccountLimits(
  tx: DbOrTx,
  member: { id: number; approvalStatus: string },
): Promise<{ isNew: boolean; waitingCount: number }> {
  const isNew = await isLimitedNewAccount(tx, member, new Date());

  const [row] = await tx
    .select({ n: sql<number>`COUNT(*)` })
    .from(exchangeRegistrations)
    .innerJoin(
      exchangeEvents,
      eq(exchangeEvents.id, exchangeRegistrations.eventId),
    )
    .where(
      and(
        eq(exchangeRegistrations.memberId, member.id),
        inArray(exchangeRegistrations.status, ["pending", "waitlist"]),
        inArray(exchangeEvents.status, ["open", "full"]),
        isNull(exchangeEvents.hiddenAt),
        gt(exchangeEvents.startAt, new Date().toISOString()),
      ),
    );
  return { isNew, waitingCount: Number(row.n) };
}

import { db } from "@/db";
import { financialTransactions, members } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { computeBalanceFromTransactions } from "./fund-core";

// Re-export pure types and functions for consumers
export {
  calculateFundDeduction,
  computeBalanceFromTransactions,
} from "./fund-core";
export type { FundBalance, FundDeductionResult } from "./fund-core";

/**
 * Roster quỹ MỚI: thành viên quỹ = member đang hoạt động VÀ đã được duyệt.
 * Không còn bảng `fund_members` — membership derive trực tiếp từ `members`.
 *
 *   trong quỹ ⇔ isActive = true AND approvalStatus = 'approved'
 *
 * "Khóa member" (toggleMemberActive → isActive=false) = rời quỹ; balance của họ
 * vẫn còn trong ledger (đóng băng), KHÔNG bị hoàn tự động.
 */
export async function getFundRosterMemberIds(): Promise<number[]> {
  const rows = await db.query.members.findMany({
    where: and(
      eq(members.isActive, true),
      eq(members.approvalStatus, "approved"),
    ),
    columns: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Calculate fund balance for a single member from the DB.
 * Đọc thuần từ ledger — không phụ thuộc roster, dùng được cả cho member đã khóa
 * (để hiển thị balance đóng băng).
 */
export async function getFundBalance(memberId: number) {
  const txs = await db.query.financialTransactions.findMany({
    where: eq(financialTransactions.memberId, memberId),
  });

  return computeBalanceFromTransactions(memberId, txs);
}

/**
 * Get fund balances for all roster members (active + approved).
 * 2 query tổng (roster + toàn bộ tx của roster) thay vì N+1.
 */
export async function getAllFundBalances() {
  const ids = await getFundRosterMemberIds();
  if (ids.length === 0) return [];

  const allTxs = await db.query.financialTransactions.findMany({
    where: inArray(financialTransactions.memberId, ids),
  });

  const byMember = new Map<number, typeof allTxs>();
  for (const id of ids) byMember.set(id, []);
  for (const tx of allTxs) {
    if (tx.memberId != null && byMember.has(tx.memberId)) {
      byMember.get(tx.memberId)!.push(tx);
    }
  }

  return ids.map((id) => computeBalanceFromTransactions(id, byMember.get(id)!));
}

/**
 * Check if a member is an active fund member (active + approved).
 */
export async function isFundMember(memberId: number): Promise<boolean> {
  const m = await db.query.members.findFirst({
    where: and(
      eq(members.id, memberId),
      eq(members.isActive, true),
      eq(members.approvalStatus, "approved"),
    ),
    columns: { id: true },
  });
  return !!m;
}

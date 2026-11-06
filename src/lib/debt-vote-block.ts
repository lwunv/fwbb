import { eq, inArray } from "drizzle-orm";
import { financialTransactions, sessions, votes } from "@/db/schema";
import type { DbLike } from "@/lib/financial-ledger";
import {
  computeBalanceFromTransactions,
  isVoteBlockedByDebt,
} from "@/lib/fund-core";
import { isVoteOpen, type SessionStatus } from "@/lib/session-status";

export type RemovedVote = { memberId: number; sessionId: number };

/**
 * Xoá phiếu của các member đang nợ quá hạn mức ở mọi buổi CÒN MỞ VOTE (đúng
 * điều kiện `isVoteOpen` mà submitVote dùng). Buổi quá hạn vote / đã chốt /
 * đã hủy giữ nguyên: lúc đó danh sách là việc của admin.
 *
 * Phải gọi SAU khi thao tác tiền đã ghi xong mọi dòng sổ, trong cùng tx, vì
 * chốt sổ lại có bước đảo khoản cũ rồi mới ghi khoản mới: kiểm giữa chừng có
 * thể thấy số dư tạm thấp và bỏ nhầm phiếu.
 * Spec: docs/superpowers/specs/2026-11-06-debt-vote-block-design.md mục 4.3.
 */
export async function enforceDebtVoteBlock(
  tx: DbLike,
  memberIds: number[],
  threshold: number,
): Promise<{ removed: RemovedVote[] }> {
  const ids = [...new Set(memberIds)];
  if (ids.length === 0) return { removed: [] };

  const txRows = await tx
    .select({
      memberId: financialTransactions.memberId,
      id: financialTransactions.id,
      type: financialTransactions.type,
      amount: financialTransactions.amount,
      reversalOfId: financialTransactions.reversalOfId,
    })
    .from(financialTransactions)
    .where(inArray(financialTransactions.memberId, ids));

  const blocked = ids.filter((memberId) => {
    const own = txRows.filter((r) => r.memberId === memberId);
    const { balance } = computeBalanceFromTransactions(memberId, own);
    return isVoteBlockedByDebt(balance, threshold);
  });
  if (blocked.length === 0) return { removed: [] };

  const candidates = await tx
    .select({
      voteId: votes.id,
      memberId: votes.memberId,
      sessionId: votes.sessionId,
      status: sessions.status,
      voteDeadline: sessions.voteDeadline,
    })
    .from(votes)
    .innerJoin(sessions, eq(sessions.id, votes.sessionId))
    .where(inArray(votes.memberId, blocked));

  const toRemove = candidates.filter(
    (c) =>
      isVoteOpen({
        status: c.status as SessionStatus,
        voteDeadline: c.voteDeadline ?? null,
      }).open,
  );
  if (toRemove.length === 0) return { removed: [] };

  await tx.delete(votes).where(
    inArray(
      votes.id,
      toRemove.map((c) => c.voteId),
    ),
  );

  return {
    removed: toRemove.map((c) => ({
      memberId: c.memberId as number,
      sessionId: c.sessionId as number,
    })),
  };
}

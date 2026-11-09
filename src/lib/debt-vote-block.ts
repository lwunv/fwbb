import { and, eq, inArray } from "drizzle-orm";
import {
  admins,
  appSettings,
  financialTransactions,
  sessions,
  votes,
} from "@/db/schema";
import type { DbLike } from "@/lib/financial-ledger";
import {
  computeBalanceFromTransactions,
  isVoteBlockedByDebt,
} from "@/lib/fund-core";
import { isVoteOpen, type SessionStatus } from "@/lib/session-status";
import { resolveGlobal } from "@/lib/settings-resolve";
import { scheduleDebtAlerts } from "@/lib/debt-alert";

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
  // Member là admin không bao giờ bị tự bỏ phiếu: số dư admin lên xuống theo
  // tiền pass sân / phần dư sàn chứ không phải nợ thật, và admin tự vote hộ.
  const adminMemberIds = new Set(
    (await tx.select({ memberId: admins.memberId }).from(admins))
      .map((a) => a.memberId)
      .filter((x): x is number => typeof x === "number"),
  );
  const ids = [...new Set(memberIds)].filter((id) => !adminMemberIds.has(id));
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

  const openCandidates = candidates.filter(
    (c) =>
      isVoteOpen({
        status: c.status as SessionStatus,
        voteDeadline: c.voteDeadline ?? null,
      }).open,
  );
  if (openCandidates.length === 0) return { removed: [] };

  // Buổi ĐÃ TỪNG chốt sổ (còn dòng fund_deduction gắn buổi, kể cả đã đảo khi
  // mở khoá) thì không bao giờ tự bỏ phiếu: mở khoá đưa buổi về 'voting' không
  // hạn, và finalize lấy người chơi từ votes, nên xoá phiếu ở đây làm lần chốt
  // lại bỏ sót tiền của member nợ (review cuối 6/11/2026).
  const finalizedSessionIds = new Set(
    (
      await tx
        .selectDistinct({ sessionId: financialTransactions.sessionId })
        .from(financialTransactions)
        .where(
          and(
            inArray(financialTransactions.sessionId, [
              ...new Set(openCandidates.map((c) => c.sessionId as number)),
            ]),
            eq(financialTransactions.type, "fund_deduction"),
          ),
        )
    ).map((r) => r.sessionId),
  );
  const toRemove = openCandidates.filter(
    (c) => !finalizedSessionIds.has(c.sessionId),
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

export type MemberMoneyChange = { memberId: number; balanceBefore: number };

/**
 * Số dư hiện tại (đọc trong tx) của từng member, để chỗ gọi chụp ở ĐẦU thao
 * tác tiền rồi truyền vào `afterMemberMoneyChange` ở CUỐI thao tác.
 */
export async function snapshotBalances(
  tx: DbLike,
  memberIds: Array<number | null | undefined>,
): Promise<MemberMoneyChange[]> {
  const ids = [
    ...new Set(memberIds.filter((x): x is number => typeof x === "number")),
  ];
  if (ids.length === 0) return [];
  const rows = await tx
    .select({
      memberId: financialTransactions.memberId,
      id: financialTransactions.id,
      type: financialTransactions.type,
      amount: financialTransactions.amount,
      reversalOfId: financialTransactions.reversalOfId,
    })
    .from(financialTransactions)
    .where(inArray(financialTransactions.memberId, ids));
  return ids.map((memberId) => ({
    memberId,
    balanceBefore: computeBalanceFromTransactions(
      memberId,
      rows.filter((r) => r.memberId === memberId),
    ).balance,
  }));
}

/**
 * Gọi ở CUỐI mọi thao tác tiền có ghi sổ cho member, trong cùng tx, sau khi
 * đã ghi xong mọi dòng sổ. Hiện làm 1 việc: bỏ phiếu của member nợ quá hạn
 * mức (mục 4.3). `balanceBefore` dành cho cảnh báo "vừa âm quỹ" (mục 4.4, nhánh
 * thông báo); bắt buộc truyền để chỗ gọi không phải sửa lần nữa.
 *
 * Hạn mức đọc TRONG tx (không qua getSettings): getSettings dùng db chung +
 * React cache, có thể trả giá trị cũ trong cùng request hoặc đọc ngoài tx.
 */
export async function afterMemberMoneyChange(
  tx: DbLike,
  changes: MemberMoneyChange[],
): Promise<{ removed: RemovedVote[] }> {
  if (changes.length === 0) return { removed: [] };
  const settingRows = await tx
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, "voteBlockDebtThreshold"));
  const threshold = resolveGlobal(settingRows).voteBlockDebtThreshold;

  // KHÔNG gọi revalidatePath ở đây: hàm này còn chạy trong lúc dựng trang
  // admin (mergeLegacyDebtsIntoFund), nơi Next cấm revalidatePath và sẽ làm
  // rollback cả thao tác tiền. Trang chủ và /vote/[id] đọc cookie nên luôn
  // dựng mới mỗi request; chỗ gọi tự revalidate trang của nó như trước.
  const result = await enforceDebtVoteBlock(
    tx,
    changes.map((c) => c.memberId),
    threshold,
  );

  // Member vừa chuyển từ ≥ 0 xuống âm → hẹn mail báo admin, gửi SAU khi trả
  // kết quả (quyết định user 9/11/2026). Bỏ qua member là admin: số dư admin
  // lên xuống theo tiền pass sân / phần dư sàn, không phải nợ thật.
  const adminIds = new Set(
    (await tx.select({ memberId: admins.memberId }).from(admins))
      .map((a) => a.memberId)
      .filter((x): x is number => typeof x === "number"),
  );
  const afterBalances = await snapshotBalances(
    tx,
    changes.map((c) => c.memberId),
  );
  scheduleDebtAlerts(
    changes
      .filter((c) => c.balanceBefore >= 0 && !adminIds.has(c.memberId))
      .map((c) => ({
        memberId: c.memberId,
        balanceBefore: c.balanceBefore,
        balanceAfter:
          afterBalances.find((b) => b.memberId === c.memberId)?.balanceBefore ??
          0,
      }))
      .filter((c) => c.balanceAfter < 0),
  );
  return result;
}

/**
 * Member có dòng sổ gắn với một buổi (phần trừ quỹ, khoản dư sàn của admin,
 * tiền pass sân...). Dùng cho thao tác cấp buổi (mở khoá, xoá buổi) để chụp
 * số dư đầu thao tác của đúng những người bị ảnh hưởng.
 */
export async function sessionLedgerMemberIds(
  tx: DbLike,
  sessionId: number,
): Promise<number[]> {
  const rows = await tx
    .selectDistinct({ memberId: financialTransactions.memberId })
    .from(financialTransactions)
    .where(eq(financialTransactions.sessionId, sessionId));
  return rows
    .map((r) => r.memberId)
    .filter((x): x is number => typeof x === "number");
}

/**
 * Member đang có phiếu ở ít nhất một buổi còn mở vote (`isVoteOpen`). Dùng khi
 * admin hạ hạn mức và cho script dọn phiếu một lần: chỉ những người này mới
 * có phiếu để bỏ.
 */
export async function findMembersWithOpenVotes(tx: DbLike): Promise<number[]> {
  const rows = await tx
    .select({
      memberId: votes.memberId,
      status: sessions.status,
      voteDeadline: sessions.voteDeadline,
    })
    .from(votes)
    .innerJoin(sessions, eq(sessions.id, votes.sessionId));
  return [
    ...new Set(
      rows
        .filter(
          (r) =>
            isVoteOpen({
              status: r.status as SessionStatus,
              voteDeadline: r.voteDeadline ?? null,
            }).open,
        )
        .map((r) => r.memberId)
        .filter((x): x is number => typeof x === "number"),
    ),
  ];
}

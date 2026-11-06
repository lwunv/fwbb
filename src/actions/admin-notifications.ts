"use server";

import { db } from "@/db";
import { financialTransactions, members } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/actions/settings";
import {
  computeBalanceFromTransactions,
  isVoteBlockedByDebt,
} from "@/lib/fund-core";
import { getFundRosterMemberIds } from "@/lib/fund-calculator";
import {
  findNegativeCrossings,
  type NegativeCrossing,
} from "@/lib/debt-history";

/** Giới hạn số dòng lịch sử trả về (mới nhất trước). */
const HISTORY_LIMIT = 100;

export type OwingMember = {
  memberId: number;
  name: string;
  nickname: string | null;
  balance: number;
  /** Nợ từ hạn mức chặn vote trở lên. */
  overLimit: boolean;
};

export type DebtHistoryItem = NegativeCrossing & {
  name: string;
  nickname: string | null;
};

/**
 * Dữ liệu chuông + trang thông báo admin (yêu cầu user 6/11/2026): ai đang âm
 * quỹ và lịch sử những lần âm quỹ. Tính từ sổ cái mỗi lần gọi, KHÔNG poll:
 * từng có sự cố hết hạn mức Turso vì trang admin quét sổ cái liên tục.
 * Chỉ member trong quỹ (đang hoạt động + đã duyệt), giống danh sách quỹ.
 */
export async function getAdminDebtNotifications(): Promise<
  | {
      owing: OwingMember[];
      history: DebtHistoryItem[];
      voteBlockDebtThreshold: number;
    }
  | { error: string }
> {
  const auth = await requireAdmin();
  if ("error" in auth) return { error: auth.error };

  const [ids, settings] = await Promise.all([
    getFundRosterMemberIds(),
    getSettings(),
  ]);
  const threshold = settings.voteBlockDebtThreshold;
  if (ids.length === 0) {
    return { owing: [], history: [], voteBlockDebtThreshold: threshold };
  }

  const [memberRows, txRows] = await Promise.all([
    db
      .select({
        id: members.id,
        name: members.name,
        nickname: members.nickname,
      })
      .from(members)
      .where(inArray(members.id, ids)),
    db
      .select({
        id: financialTransactions.id,
        memberId: financialTransactions.memberId,
        type: financialTransactions.type,
        amount: financialTransactions.amount,
        reversalOfId: financialTransactions.reversalOfId,
        createdAt: financialTransactions.createdAt,
        description: financialTransactions.description,
      })
      .from(financialTransactions)
      .where(inArray(financialTransactions.memberId, ids)),
  ]);

  const byMember = new Map<number, typeof txRows>();
  for (const r of txRows) {
    if (r.memberId == null) continue;
    const list = byMember.get(r.memberId) ?? [];
    list.push(r);
    byMember.set(r.memberId, list);
  }

  const owing: OwingMember[] = [];
  const history: DebtHistoryItem[] = [];
  for (const m of memberRows) {
    const rows = byMember.get(m.id) ?? [];
    const { balance } = computeBalanceFromTransactions(m.id, rows);
    if (balance < 0) {
      owing.push({
        memberId: m.id,
        name: m.name,
        nickname: m.nickname,
        balance,
        overLimit: isVoteBlockedByDebt(balance, threshold),
      });
    }
    for (const c of findNegativeCrossings(m.id, rows)) {
      history.push({ ...c, name: m.name, nickname: m.nickname });
    }
  }

  owing.sort((a, b) => a.balance - b.balance || a.name.localeCompare(b.name));
  history.sort((a, b) => b.at.localeCompare(a.at) || b.txId - a.txId);

  return {
    owing,
    history: history.slice(0, HISTORY_LIMIT),
    voteBlockDebtThreshold: threshold,
  };
}

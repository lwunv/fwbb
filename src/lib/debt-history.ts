import { computeBalanceFromTransactions } from "@/lib/fund-core";

export type NegativeCrossing = {
  memberId: number;
  /** Dòng sổ cuối của thao tác làm số dư rơi xuống âm. */
  txId: number;
  at: string;
  balanceBefore: number;
  balanceAfter: number;
  description: string | null;
};

type LedgerRow = {
  id: number;
  type: string;
  amount: number;
  reversalOfId?: number | null;
  createdAt: string | null;
  description?: string | null;
};

/**
 * Những lần số dư quỹ của member chuyển từ ≥ 0 xuống < 0, tính lại từ sổ cái
 * (trang thông báo admin, yêu cầu user 6/11/2026). Không lưu sự kiện riêng nên
 * luôn khớp sổ, và có sẵn cả các lần trong quá khứ.
 *
 * Số dư sau mỗi bước tính bằng ĐÚNG `computeBalanceFromTransactions` trên phần
 * sổ tới thời điểm đó (một nguồn sự thật). Các dòng cùng `createdAt` coi là
 * MỘT thao tác: chốt sổ lại đảo khoản cũ rồi ghi khoản mới trong cùng giây,
 * xét từng dòng sẽ thấy số dư tạm nhảy lên ≥ 0 và đếm nhầm một lần âm giả.
 */
export function findNegativeCrossings(
  memberId: number,
  rows: ReadonlyArray<LedgerRow>,
): NegativeCrossing[] {
  const sorted = [...rows].sort(
    (a, b) =>
      (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id - b.id,
  );
  const out: NegativeCrossing[] = [];
  let prevBalance = 0;
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (
      j + 1 < sorted.length &&
      sorted[j + 1].createdAt === sorted[i].createdAt
    ) {
      j++;
    }
    const balance = computeBalanceFromTransactions(
      memberId,
      sorted.slice(0, j + 1),
    ).balance;
    if (prevBalance >= 0 && balance < 0) {
      const last = sorted[j];
      out.push({
        memberId,
        txId: last.id,
        at: last.createdAt ?? "",
        balanceBefore: prevBalance,
        balanceAfter: balance,
        description: last.description ?? null,
      });
    }
    prevBalance = balance;
    i = j + 1;
  }
  return out;
}

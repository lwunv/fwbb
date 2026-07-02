/**
 * Phân bổ trạng thái "đã trả" per-buổi cho mô hình Quỹ+Nợ gộp (chỉ có 1
 * balance tổng). Quy ước FIFO đã chốt với user 2026-07-02 (xem spec
 * docs/superpowers/specs/2026-07-02-member-play-history-design.md): tiền nạp
 * trừ cho buổi CŨ trước, nên phần thiếu (balance âm) ăn vào các buổi MỚI
 * nhất. Buổi 0 đồng không ăn deficit.
 *
 * KHÔNG đọc ledger ở đây — caller phải đưa balance đã tính bằng helper chuẩn
 * (computeBalanceFromTransactions) để không nhân bản semantics ledger.
 */
export type PaidStatus = "paid" | "partial" | "unpaid";

export function attributePaidFifo(
  charges: Array<{ sessionId: number; date: string; totalAmount: number }>,
  balance: number,
): Record<number, PaidStatus> {
  const result: Record<number, PaidStatus> = {};
  let deficit = Math.max(0, -balance);
  const newestFirst = [...charges].sort(
    (a, b) => b.date.localeCompare(a.date) || b.sessionId - a.sessionId,
  );
  for (const c of newestFirst) {
    if (deficit <= 0 || c.totalAmount <= 0) {
      result[c.sessionId] = "paid";
      continue;
    }
    if (deficit >= c.totalAmount) {
      result[c.sessionId] = "unpaid";
      deficit -= c.totalAmount;
    } else {
      result[c.sessionId] = "partial";
      deficit = 0;
    }
  }
  return result;
}

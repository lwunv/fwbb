import { ymdInVN } from "@/lib/date-format";

/** Các cột sổ cái cần để dựng lại lịch sử số dư của một member. */
export type FinancialTransactionRow = {
  id: number;
  type: string;
  amount: number;
  reversalOfId: number | null;
  createdAt: string | null;
};

const DAY_MS = 24 * 3_600_000;

/**
 * Thời điểm của một dòng sổ. Cột có default `current_timestamp` của SQLite
 * (`YYYY-MM-DD HH:MM:SS`, giờ UTC không ký hiệu); dòng app ghi là ISO có `Z`.
 */
function instantOf(createdAt: string): number {
  return createdAt.includes("T")
    ? Date.parse(createdAt)
    : Date.parse(`${createdAt.replace(" ", "T")}Z`);
}

/** Thay đổi số dư của một dòng, đúng bảng loại của `computeBalanceFromTransactions`. */
function delta(type: string, amount: number): number {
  switch (type) {
    case "fund_contribution":
      return amount;
    case "fund_deduction":
    case "fund_refund":
      return -amount;
    default:
      // bank_payment_received và các loại khác không đổi số dư.
      return 0;
  }
}

/**
 * Ngày VN (`YYYY-MM-DD`) của giao dịch làm số dư chuyển sang âm lần gần nhất,
 * tính sau lần cuối số dư ≥ 0; `null` nếu số dư hiện tại ≥ 0. Dùng đúng luật
 * của `computeBalanceFromTransactions`: bỏ cả dòng đảo lẫn dòng gốc bị đảo,
 * chỉ ba loại quỹ đổi số dư. Duyệt theo `createdAt` rồi `id`. Dòng thiếu
 * `createdAt` coi như của `todayYmd`.
 */
export function debtSinceYmd(
  rows: FinancialTransactionRow[],
  todayYmd: string,
): string | null {
  const voided = new Set<number>();
  for (const r of rows) if (r.reversalOfId != null) voided.add(r.reversalOfId);

  const todayInstant = Date.parse(`${todayYmd}T00:00:00+07:00`);
  const timeline = rows
    .filter((r) => r.reversalOfId == null && !voided.has(r.id))
    .map((r) => ({
      id: r.id,
      at: r.createdAt ? instantOf(r.createdAt) : todayInstant,
      delta: delta(r.type, r.amount),
    }))
    .sort((a, b) => a.at - b.at || a.id - b.id);

  let balance = 0;
  let since: string | null = null;
  for (const step of timeline) {
    const before = balance;
    balance += step.delta;
    if (balance >= 0) since = null;
    else if (before >= 0) since = ymdInVN(new Date(step.at));
  }
  return balance < 0 ? since : null;
}

/** Số ngày lịch giữa hai ngày `YYYY-MM-DD` (tuổi nợ khi `from` là `debtSinceYmd`). */
export function debtAgeDays(fromYmd: string, toYmd: string): number {
  // Hai mốc đều là 00:00 UTC nên hiệu luôn là bội số đúng của một ngày.
  return (
    (Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) /
    DAY_MS
  );
}

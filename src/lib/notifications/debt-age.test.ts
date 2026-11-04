import { describe, it, expect } from "vitest";
import {
  debtAgeDays,
  debtSinceYmd,
  type FinancialTransactionRow,
} from "./debt-age";

let nextId = 1;
function row(
  type: string,
  amount: number,
  createdAt: string,
  extra: Partial<FinancialTransactionRow> = {},
): FinancialTransactionRow {
  return {
    id: nextId++,
    type,
    amount,
    reversalOfId: null,
    createdAt,
    ...extra,
  };
}

describe("debtSinceYmd", () => {
  it("member who went negative on Nov 2, topped up, went negative again on Nov 5 → Nov 5; balance ≥ 0 → null", () => {
    // 22:30 VN = 15:30Z cùng ngày; 23:30 VN = 16:30Z (vẫn là ngày VN đó).
    const rows = [
      row("fund_deduction", 60_000, "2026-11-02T15:30:00.000Z"),
      // Nạp 120K: +60K; buổi ngày 4 trừ 60K về đúng 0 (chưa nợ).
      row("fund_contribution", 120_000, "2026-11-03T02:00:00.000Z"),
      row("fund_deduction", 60_000, "2026-11-04T15:30:00.000Z"),
      row("fund_deduction", 60_000, "2026-11-05T16:30:00.000Z"),
    ];
    expect(debtSinceYmd(rows, "2026-11-08")).toBe("2026-11-05");

    const paid = [
      ...rows,
      row("fund_contribution", 80_000, "2026-11-06T02:00:00.000Z"),
    ];
    expect(debtSinceYmd(paid, "2026-11-08")).toBeNull();
  });

  it("reads the VN calendar day, not the UTC one (SQLite default timestamps are UTC)", () => {
    // 2026-11-02 18:00 UTC = 01:00 VN ngày 3.
    expect(
      debtSinceYmd(
        [row("fund_deduction", 60_000, "2026-11-02 18:00:00")],
        "2026-11-08",
      ),
    ).toBe("2026-11-03");
  });

  it("ignores reversal pairs and bank_payment_received, like computeBalanceFromTransactions", () => {
    const deduction = row("fund_deduction", 60_000, "2026-11-02T15:30:00.000Z");
    const rows = [
      row("fund_contribution", 50_000, "2026-11-01T02:00:00.000Z"),
      deduction,
      // Khoản trừ ngày 2 bị đảo: cả cặp biến mất khỏi lịch sử.
      row("fund_contribution", 60_000, "2026-11-03T02:00:00.000Z", {
        reversalOfId: deduction.id,
      }),
      // Chỉ là dòng kiểm toán, tiền thật vào qua fund_contribution kèm theo.
      row("bank_payment_received", 500_000, "2026-11-04T02:00:00.000Z"),
      row("fund_deduction", 70_000, "2026-11-06T15:30:00.000Z"),
    ];
    expect(debtSinceYmd(rows, "2026-11-08")).toBe("2026-11-06");
  });

  it("orders same-day rows by id so a debt paid later that day still counts as cleared", () => {
    const rows = [
      row("fund_deduction", 60_000, "2026-11-02T15:30:00.000Z"),
      row("fund_contribution", 60_000, "2026-11-02T15:30:00.000Z"),
    ];
    expect(debtSinceYmd(rows, "2026-11-08")).toBeNull();
  });

  it("returns null for an empty ledger", () => {
    expect(debtSinceYmd([], "2026-11-08")).toBeNull();
  });
});

describe("debtAgeDays", () => {
  it("counts whole VN days between the two dates, across month ends", () => {
    expect(debtAgeDays("2026-11-02", "2026-11-02")).toBe(0);
    expect(debtAgeDays("2026-11-02", "2026-11-03")).toBe(1);
    expect(debtAgeDays("2026-11-02", "2026-12-02")).toBe(30);
  });
});

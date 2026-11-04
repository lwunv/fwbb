import { describe, it, expect } from "vitest";
import {
  debtAgeDays,
  debtSinceYmd,
  type FinancialTransactionRow,
} from "./debt-age";
import { computeBalanceFromTransactions } from "@/lib/fund-core";

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

/**
 * Tuổi nợ chỉ đọc sổ, nhưng phải cùng luật với số dư thật: có ngày bắt đầu nợ
 * khi và chỉ khi `computeBalanceFromTransactions` ra số âm. Lệch là member
 * đang dương bị nhắc nợ, hoặc người đang nợ không bao giờ được nhắc.
 */
describe("debtSinceYmd parity with computeBalanceFromTransactions", () => {
  const TODAY = "2026-11-08";
  const isDebt = (rows: FinancialTransactionRow[]) =>
    computeBalanceFromTransactions(1, rows).balance < 0;

  function fixtures(): Record<string, FinancialTransactionRow[]> {
    nextId = 1000;
    const ded = row("fund_deduction", 60_000, "2026-11-02T15:30:00.000Z");
    const con = row("fund_contribution", 60_000, "2026-11-03T02:00:00.000Z");
    const conPaid = row(
      "fund_contribution",
      100_000,
      "2026-11-01T02:00:00.000Z",
    );
    const dedVoid = row("fund_deduction", 150_000, "2026-11-04T15:30:00.000Z");
    const ref = row("fund_refund", 40_000, "2026-11-05T02:00:00.000Z");
    return {
      "single deduction": [ded],
      "deduction then equal top-up": [ded, con],
      "reversed deduction (pair drops out)": [
        conPaid,
        dedVoid,
        row("fund_contribution", 150_000, "2026-11-05T02:00:00.000Z", {
          reversalOfId: dedVoid.id,
        }),
      ],
      "reversed top-up leaves the debt": [
        row("fund_deduction", 50_000, "2026-11-01T15:30:00.000Z"),
        con,
        row("fund_deduction", 60_000, "2026-11-06T02:00:00.000Z", {
          reversalOfId: con.id,
        }),
      ],
      "bank_payment_received never moves the balance": [
        ded,
        row("bank_payment_received", 60_000, "2026-11-03T02:00:00.000Z"),
      ],
      "refunds drive a positive fund negative": [
        conPaid,
        ref,
        row("fund_refund", 70_000, "2026-11-06T02:00:00.000Z"),
      ],
      "refund within the fund": [conPaid, ref],
      "SQLite timestamp and missing createdAt": [
        row("fund_contribution", 30_000, "2026-11-01 02:00:00"),
        { ...row("fund_deduction", 45_000, "x"), createdAt: null },
      ],
      "same instant, contribution first by id": [
        row("fund_contribution", 20_000, "2026-11-03T02:00:00.000Z"),
        row("fund_deduction", 20_000, "2026-11-03T02:00:00.000Z"),
      ],
      empty: [],
    };
  }

  it("named ledgers: a debt start date exists exactly when the balance is negative", () => {
    for (const [name, rows] of Object.entries(fixtures())) {
      expect(debtSinceYmd(rows, TODAY) !== null, name).toBe(isDebt(rows));
    }
  });

  it("400 generated ledgers with reversals agree as well", () => {
    // LCG có hạt giống cố định: lặp lại được, không phụ thuộc Math.random.
    let seed = 20261104;
    const rand = (n: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % n;
    };
    const types = [
      "fund_contribution",
      "fund_deduction",
      "fund_refund",
      "bank_payment_received",
    ];
    for (let k = 0; k < 400; k++) {
      nextId = 1;
      const rows: FinancialTransactionRow[] = [];
      const len = 1 + rand(8);
      for (let i = 0; i < len; i++) {
        const day = String(1 + rand(7)).padStart(2, "0");
        const at = `2026-11-${day}T0${rand(10)}:00:00.000Z`;
        const reversible = rows.filter((r) => r.reversalOfId === null);
        if (reversible.length > 0 && rand(4) === 0) {
          const target = reversible[rand(reversible.length)];
          rows.push(
            row(
              target.type === "fund_contribution"
                ? "fund_deduction"
                : "fund_contribution",
              target.amount,
              at,
              { reversalOfId: target.id },
            ),
          );
        } else {
          rows.push(
            row(types[rand(types.length)], (1 + rand(10)) * 10_000, at),
          );
        }
      }
      expect(debtSinceYmd(rows, TODAY) !== null, JSON.stringify(rows)).toBe(
        isDebt(rows),
      );
    }
  });
});

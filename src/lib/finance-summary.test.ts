import { describe, it, expect } from "vitest";
import {
  bucketMonthlyTransactions,
  type LedgerRowForSummary,
} from "./finance-summary";

function row(
  id: number,
  type: string,
  direction: "in" | "out" | "neutral",
  amount: number,
  reversalOfId: number | null = null,
): LedgerRowForSummary {
  return { id, type, direction, amount, reversalOfId };
}

describe("bucketMonthlyTransactions", () => {
  it("buckets fund_contribution into realIn (not realOut)", () => {
    const r = bucketMonthlyTransactions([
      row(1, "fund_contribution", "in", 200_000),
    ]);
    expect(r.realIn).toBe(200_000);
    expect(r.realOut).toBe(0);
  });

  it("excludes bank_payment_received — it's paired with fund_contribution", () => {
    // Bank webhook for a debt inserts BOTH rows; counting both would double up.
    const r = bucketMonthlyTransactions([
      row(1, "bank_payment_received", "in", 200_000),
      row(2, "fund_contribution", "in", 200_000),
    ]);
    expect(r.realIn).toBe(200_000);
  });

  it("excludes legacy debt_member_confirmed / debt_admin_confirmed", () => {
    const r = bucketMonthlyTransactions([
      row(1, "debt_member_confirmed", "in", 150_000),
      row(2, "debt_admin_confirmed", "in", 150_000),
    ]);
    expect(r.realIn).toBe(0);
  });

  it("excludes fund_deduction from realOut (internal redistribution)", () => {
    // Admin paid 200k for court (recorded as court_rent_payment), then
    // finalizeSession created 4× 50k fund_deduction to allocate to members.
    // Real cash out is 200k, not 400k.
    const r = bucketMonthlyTransactions([
      row(1, "court_rent_payment", "out", 200_000),
      row(2, "fund_deduction", "out", 50_000),
      row(3, "fund_deduction", "out", 50_000),
      row(4, "fund_deduction", "out", 50_000),
      row(5, "fund_deduction", "out", 50_000),
    ]);
    expect(r.realOut).toBe(200_000);
    expect(r.fundDeductions).toBe(200_000);
    expect(r.courtRentSpend).toBe(200_000);
  });

  it("buckets inventory_purchase and court_rent_payment into realOut + their own subtotals", () => {
    const r = bucketMonthlyTransactions([
      row(1, "inventory_purchase", "out", 300_000),
      row(2, "court_rent_payment", "out", 200_000),
      row(3, "fund_refund", "out", 50_000),
    ]);
    expect(r.realOut).toBe(550_000);
    expect(r.inventorySpend).toBe(300_000);
    expect(r.courtRentSpend).toBe(200_000);
    expect(r.fundRefundSpend).toBe(50_000);
  });

  it("manual_adjustment splits by direction", () => {
    const r = bucketMonthlyTransactions([
      row(1, "manual_adjustment", "in", 100_000),
      row(2, "manual_adjustment", "out", 30_000),
    ]);
    expect(r.realIn).toBe(100_000);
    expect(r.realOut).toBe(30_000);
  });

  it("buckets session_guest_income into realIn (tiền khách của admin vào quỹ)", () => {
    const r = bucketMonthlyTransactions([
      row(1, "session_guest_income", "in", 60_000),
    ]);
    expect(r.realIn).toBe(60_000);
    expect(r.realOut).toBe(0);
  });

  it("cancels a reversed session_guest_income pair to 0", () => {
    const r = bucketMonthlyTransactions([
      row(1, "session_guest_income", "in", 60_000),
      row(2, "session_guest_income", "out", 60_000, 1), // reversal of #1
    ]);
    expect(r.realIn).toBe(0);
  });

  it("cancels reversal pairs — both original and reversal contribute 0", () => {
    const r = bucketMonthlyTransactions([
      row(1, "fund_contribution", "in", 200_000),
      row(2, "fund_refund", "out", 200_000, 1), // reversal of #1
    ]);
    expect(r.realIn).toBe(0);
    expect(r.realOut).toBe(0);
    expect(r.fundRefundSpend).toBe(0);
  });

  it("keeps an un-reversed contribution while filtering only the reversed one", () => {
    const r = bucketMonthlyTransactions([
      row(1, "fund_contribution", "in", 200_000), // reversed
      row(2, "fund_refund", "out", 200_000, 1),
      row(3, "fund_contribution", "in", 150_000), // alive
    ]);
    expect(r.realIn).toBe(150_000);
    expect(r.realOut).toBe(0);
  });

  it("ignores debt_created neutral rows", () => {
    const r = bucketMonthlyTransactions([
      row(1, "debt_created", "neutral", 100_000),
    ]);
    expect(r.realIn).toBe(0);
    expect(r.realOut).toBe(0);
  });

  it("repro of the 5/2026 dashboard double-count bug", () => {
    // Scenario: 1 bank transfer of 200k for a debt (3 rows from webhook),
    // 1 manual contribution 100k, 1 court rent payment 200k, 1 finalize
    // creating 4× 50k fund_deductions, 1 inventory purchase 300k.
    //
    // Naive direction=in sum:  200 + 200 + 100 = 500k (×2 the real)
    // Naive direction=out sum: 200 + 4×50 + 300 = 700k (×1.4 the real)
    // Correct:                 realIn = 300k, realOut = 500k.
    const rows: LedgerRowForSummary[] = [
      row(1, "bank_payment_received", "in", 200_000),
      row(2, "fund_contribution", "in", 200_000), // bank balance fix
      row(3, "debt_admin_confirmed", "neutral", 200_000),
      row(4, "fund_contribution", "in", 100_000), // manual contribution
      row(5, "court_rent_payment", "out", 200_000),
      row(6, "fund_deduction", "out", 50_000),
      row(7, "fund_deduction", "out", 50_000),
      row(8, "fund_deduction", "out", 50_000),
      row(9, "fund_deduction", "out", 50_000),
      row(10, "inventory_purchase", "out", 300_000),
    ];
    const r = bucketMonthlyTransactions(rows);
    expect(r.realIn).toBe(300_000);
    expect(r.realOut).toBe(500_000);
    expect(r.inventorySpend).toBe(300_000);
    expect(r.courtRentSpend).toBe(200_000);
    expect(r.fundDeductions).toBe(200_000);
  });
});

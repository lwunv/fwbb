import { describe, it, expect } from "vitest";
import {
  calculateFundDeduction,
  computeBalanceFromTransactions,
  type FundDeductionResult,
} from "./fund-core";

describe("computeBalanceFromTransactions", () => {
  it("should return zero balance for empty transactions", () => {
    const result = computeBalanceFromTransactions(1, []);
    expect(result.balance).toBe(0);
    expect(result.totalContributions).toBe(0);
    expect(result.totalDeductions).toBe(0);
    expect(result.totalRefunds).toBe(0);
  });

  it("should sum contributions correctly", () => {
    const txs = [
      { type: "fund_contribution", amount: 500000 },
      { type: "fund_contribution", amount: 300000 },
    ];
    const result = computeBalanceFromTransactions(1, txs);
    expect(result.totalContributions).toBe(800000);
    expect(result.balance).toBe(800000);
  });

  it("should subtract deductions and refunds", () => {
    const txs = [
      { type: "fund_contribution", amount: 1000000 },
      { type: "fund_deduction", amount: 300000 },
      { type: "fund_refund", amount: 200000 },
    ];
    const result = computeBalanceFromTransactions(1, txs);
    expect(result.totalContributions).toBe(1000000);
    expect(result.totalDeductions).toBe(300000);
    expect(result.totalRefunds).toBe(200000);
    expect(result.balance).toBe(500000);
  });

  it("should allow negative balance", () => {
    const txs = [
      { type: "fund_contribution", amount: 100000 },
      { type: "fund_deduction", amount: 300000 },
    ];
    const result = computeBalanceFromTransactions(1, txs);
    expect(result.balance).toBe(-200000);
  });

  it("should set memberId correctly", () => {
    const result = computeBalanceFromTransactions(42, []);
    expect(result.memberId).toBe(42);
  });

  it("should ignore unknown transaction types", () => {
    const txs = [
      { type: "fund_contribution", amount: 500000 },
      { type: "unknown_type", amount: 999999 },
    ];
    const result = computeBalanceFromTransactions(1, txs);
    expect(result.balance).toBe(500000);
  });
});

describe("calculateFundDeduction", () => {
  it("should return zero deduction when balance is 0", () => {
    const result = calculateFundDeduction(0, 100000);
    expect(result).toEqual<FundDeductionResult>({
      deductedFromFund: 0,
      remainingDebt: 100000,
      fullyPaidByFund: false,
    });
  });

  it("should return zero deduction when balance is negative", () => {
    const result = calculateFundDeduction(-50000, 100000);
    expect(result).toEqual<FundDeductionResult>({
      deductedFromFund: 0,
      remainingDebt: 100000,
      fullyPaidByFund: false,
    });
  });

  it("should return zero deduction when debt is 0", () => {
    const result = calculateFundDeduction(500000, 0);
    expect(result).toEqual<FundDeductionResult>({
      deductedFromFund: 0,
      remainingDebt: 0,
      fullyPaidByFund: false,
    });
  });

  it("should fully pay debt when balance >= debt", () => {
    const result = calculateFundDeduction(500000, 200000);
    expect(result).toEqual<FundDeductionResult>({
      deductedFromFund: 200000,
      remainingDebt: 0,
      fullyPaidByFund: true,
    });
  });

  it("should fully pay debt when balance exactly equals debt", () => {
    const result = calculateFundDeduction(150000, 150000);
    expect(result).toEqual<FundDeductionResult>({
      deductedFromFund: 150000,
      remainingDebt: 0,
      fullyPaidByFund: true,
    });
  });

  it("should partially pay debt when balance < debt", () => {
    const result = calculateFundDeduction(80000, 200000);
    expect(result).toEqual<FundDeductionResult>({
      deductedFromFund: 80000,
      remainingDebt: 120000,
      fullyPaidByFund: false,
    });
  });

  it("should handle typical VND amounts (large numbers)", () => {
    // 2,000,000 balance, 3,500,000 debt
    const result = calculateFundDeduction(2000000, 3500000);
    expect(result).toEqual<FundDeductionResult>({
      deductedFromFund: 2000000,
      remainingDebt: 1500000,
      fullyPaidByFund: false,
    });
  });

  it("should handle 1 VND edge case (integers only)", () => {
    const result = calculateFundDeduction(1, 1);
    expect(result).toEqual<FundDeductionResult>({
      deductedFromFund: 1,
      remainingDebt: 0,
      fullyPaidByFund: true,
    });
  });

  // CRITICAL: All values must stay as integers
  it("should never produce fractional results", () => {
    const testCases = [
      { balance: 333333, debt: 500000 },
      { balance: 1, debt: 3 },
      { balance: 999999, debt: 1000000 },
    ];

    for (const { balance, debt } of testCases) {
      const result = calculateFundDeduction(balance, debt);
      expect(Number.isInteger(result.deductedFromFund)).toBe(true);
      expect(Number.isInteger(result.remainingDebt)).toBe(true);
      // Conservation: deducted + remaining = debt
      expect(result.deductedFromFund + result.remainingDebt).toBe(debt);
    }
  });
});

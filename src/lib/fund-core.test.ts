import { describe, expect, it } from "vitest";
import {
  LOW_FUND_THRESHOLD,
  getFundStatus,
  computeBalancesForMembers,
  type FundStatus,
} from "./fund-core";

describe("getFundStatus", () => {
  it("returns 'owing' for negative balance", () => {
    expect(getFundStatus(-1)).toBe<FundStatus>("owing");
    expect(getFundStatus(-100_000)).toBe<FundStatus>("owing");
  });

  it("returns 'depleted' for exactly zero", () => {
    expect(getFundStatus(0)).toBe<FundStatus>("depleted");
  });

  it("returns 'lowFund' for 0 < balance < threshold", () => {
    expect(getFundStatus(1)).toBe<FundStatus>("lowFund");
    expect(getFundStatus(50_000)).toBe<FundStatus>("lowFund");
    expect(getFundStatus(LOW_FUND_THRESHOLD - 1)).toBe<FundStatus>("lowFund");
  });

  it("returns 'hasFund' for balance >= threshold", () => {
    expect(getFundStatus(LOW_FUND_THRESHOLD)).toBe<FundStatus>("hasFund");
    expect(getFundStatus(100_000)).toBe<FundStatus>("hasFund");
    expect(getFundStatus(200_000)).toBe<FundStatus>("hasFund");
  });

  it("LOW_FUND_THRESHOLD is 100_000 VND", () => {
    expect(LOW_FUND_THRESHOLD).toBe(100_000);
  });
});

describe("computeBalancesForMembers", () => {
  it("returns empty object for empty memberIds", () => {
    expect(computeBalancesForMembers([], [])).toEqual({});
  });

  it("returns 0 for members with no transactions", () => {
    expect(computeBalancesForMembers([1, 2], [])).toEqual({ 1: 0, 2: 0 });
  });

  it("groups transactions by memberId correctly", () => {
    const txs = [
      { memberId: 1, type: "fund_contribution", amount: 100_000 },
      { memberId: 1, type: "fund_deduction", amount: 30_000 },
      { memberId: 2, type: "fund_contribution", amount: 50_000 },
      { memberId: 2, type: "fund_refund", amount: 20_000 },
    ];
    expect(computeBalancesForMembers([1, 2], txs)).toEqual({
      1: 70_000, // 100K - 30K
      2: 30_000, // 50K - 20K
    });
  });

  it("ignores transactions for member IDs not requested", () => {
    const txs = [
      { memberId: 1, type: "fund_contribution", amount: 100_000 },
      { memberId: 99, type: "fund_contribution", amount: 999_000 },
    ];
    expect(computeBalancesForMembers([1], txs)).toEqual({ 1: 100_000 });
  });

  it("handles reversal pairs (excludes both original and reversal)", () => {
    const txs = [
      { id: 10, memberId: 1, type: "fund_contribution", amount: 100_000 },
      {
        id: 11,
        memberId: 1,
        type: "fund_contribution",
        amount: -100_000,
        reversalOfId: 10,
      },
      { id: 12, memberId: 1, type: "fund_contribution", amount: 50_000 },
    ];
    expect(computeBalancesForMembers([1], txs)).toEqual({ 1: 50_000 });
  });
});

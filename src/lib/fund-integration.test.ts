import { describe, it, expect } from "vitest";
import { calculateSessionCosts, type AttendeeInput } from "./cost-calculator";
import { calculateFundDeduction } from "./fund-core";

/**
 * Integration test: simulates the full finalizeSession flow
 * without hitting the database.
 *
 * Tests the interaction between cost-calculator and fund-calculator
 * to ensure fund deduction + debt creation produces correct results.
 */
describe("Fund + Cost Integration", () => {
  function makeAttendee(
    memberId: number,
    play: boolean,
    dine: boolean,
  ): AttendeeInput {
    return {
      memberId,
      guestName: null,
      invitedById: null,
      isGuest: false,
      attendsPlay: play,
      attendsDine: dine,
    };
  }

  // Simulate the finalizeSession logic for fund members
  function simulateFinalize(
    courtPrice: number,
    diningBill: number,
    attendees: AttendeeInput[],
    fundBalances: Map<number, number>, // memberId → fund balance
  ) {
    const breakdown = calculateSessionCosts(
      { courtPrice, diningBill },
      attendees,
      [],
    );

    const results: Array<{
      memberId: number;
      originalDebt: number;
      deductedFromFund: number;
      finalDebt: number;
      fullyPaidByFund: boolean;
    }> = [];

    let totalFundDeductions = 0;

    for (const debt of breakdown.memberDebts) {
      const balance = fundBalances.get(debt.memberId) ?? 0;
      const isFundMember = fundBalances.has(debt.memberId);

      if (isFundMember && balance > 0) {
        const deduction = calculateFundDeduction(balance, debt.totalAmount);
        totalFundDeductions += deduction.deductedFromFund;

        // Update remaining balance for subsequent iterations
        fundBalances.set(debt.memberId, balance - deduction.deductedFromFund);

        results.push({
          memberId: debt.memberId,
          originalDebt: debt.totalAmount,
          deductedFromFund: deduction.deductedFromFund,
          finalDebt: deduction.remainingDebt,
          fullyPaidByFund: deduction.fullyPaidByFund,
        });
      } else {
        results.push({
          memberId: debt.memberId,
          originalDebt: debt.totalAmount,
          deductedFromFund: 0,
          finalDebt: debt.totalAmount,
          fullyPaidByFund: false,
        });
      }
    }

    return { breakdown, results, totalFundDeductions };
  }

  it("should fully cover fund member debt and leave non-fund member debt untouched", () => {
    const attendees = [
      makeAttendee(1, true, true), // Fund member, 500k balance
      makeAttendee(2, true, true), // Non-fund member
      makeAttendee(3, true, false), // Fund member, 100k balance
    ];

    const fundBalances = new Map([
      [1, 500000], // plenty of balance
      [3, 100000], // just enough for play only
    ]);

    const { breakdown, results } = simulateFinalize(
      300000, // court
      200000, // dining
      attendees,
      fundBalances,
    );

    // Play: 300k / 3 = 100k each
    // Dine: 200k / 2 = 100k each (only member 1 and 2 dine)
    expect(breakdown.playCostPerHead).toBe(100000);
    expect(breakdown.dineCostPerHead).toBe(100000);

    // Member 1 (fund, 500k): play(100k) + dine(100k) = 200k → fully covered
    const m1 = results.find((r) => r.memberId === 1)!;
    expect(m1.originalDebt).toBe(200000);
    expect(m1.deductedFromFund).toBe(200000);
    expect(m1.finalDebt).toBe(0);
    expect(m1.fullyPaidByFund).toBe(true);

    // Member 2 (non-fund): play(100k) + dine(100k) = 200k → full debt
    const m2 = results.find((r) => r.memberId === 2)!;
    expect(m2.originalDebt).toBe(200000);
    expect(m2.deductedFromFund).toBe(0);
    expect(m2.finalDebt).toBe(200000);
    expect(m2.fullyPaidByFund).toBe(false);

    // Member 3 (fund, 100k): play only = 100k → exactly covered
    const m3 = results.find((r) => r.memberId === 3)!;
    expect(m3.originalDebt).toBe(100000);
    expect(m3.deductedFromFund).toBe(100000);
    expect(m3.finalDebt).toBe(0);
    expect(m3.fullyPaidByFund).toBe(true);
  });

  it("should partially cover debt when fund balance is insufficient", () => {
    const attendees = [
      makeAttendee(1, true, true), // Fund member, only 50k
    ];

    const fundBalances = new Map([[1, 50000]]);

    const { results } = simulateFinalize(
      200000,
      100000,
      attendees,
      fundBalances,
    );

    // Member 1: play(200k) + dine(100k) = 300k, fund only has 50k
    const m1 = results[0];
    expect(m1.originalDebt).toBe(300000);
    expect(m1.deductedFromFund).toBe(50000);
    expect(m1.finalDebt).toBe(250000);
    expect(m1.fullyPaidByFund).toBe(false);
  });

  it("should handle fund member with zero balance like non-fund member", () => {
    const attendees = [makeAttendee(1, true, false)];
    const fundBalances = new Map([[1, 0]]);

    const { results } = simulateFinalize(100000, 0, attendees, fundBalances);

    const m1 = results[0];
    expect(m1.deductedFromFund).toBe(0);
    expect(m1.finalDebt).toBe(100000);
    expect(m1.fullyPaidByFund).toBe(false);
  });

  it("should preserve integer amounts throughout the entire flow", () => {
    const attendees = [
      makeAttendee(1, true, true),
      makeAttendee(2, true, true),
      makeAttendee(3, true, true),
    ];

    // Amounts that would cause fractional division: 250k / 3 = 83,333.33
    const fundBalances = new Map([
      [1, 45000],
      [2, 999999],
    ]);

    const { breakdown, results } = simulateFinalize(
      250000,
      170000,
      attendees,
      fundBalances,
    );

    // Verify all costs are integers
    expect(Number.isInteger(breakdown.playCostPerHead)).toBe(true);
    expect(Number.isInteger(breakdown.dineCostPerHead)).toBe(true);

    for (const r of results) {
      expect(Number.isInteger(r.originalDebt)).toBe(true);
      expect(Number.isInteger(r.deductedFromFund)).toBe(true);
      expect(Number.isInteger(r.finalDebt)).toBe(true);

      // Conservation law: deducted + final = original
      expect(r.deductedFromFund + r.finalDebt).toBe(r.originalDebt);
    }
  });

  it("should handle session with guests + fund correctly", () => {
    const attendees: AttendeeInput[] = [
      makeAttendee(1, true, true), // Fund member, brings 1 guest
      makeAttendee(2, true, false), // Non-fund
      {
        memberId: null,
        guestName: "Khách A",
        invitedById: 1,
        isGuest: true,
        attendsPlay: true,
        attendsDine: false,
      },
    ];

    const fundBalances = new Map([[1, 300000]]);

    const { breakdown, results } = simulateFinalize(
      300000,
      0,
      attendees,
      fundBalances,
    );

    // 3 players total: 300k / 3 = 100k each
    expect(breakdown.playCostPerHead).toBe(100000);

    // Member 1: own play(100k) + guest play(100k) = 200k, fund covers all
    const m1 = results.find((r) => r.memberId === 1)!;
    expect(m1.originalDebt).toBe(200000);
    expect(m1.deductedFromFund).toBe(200000);
    expect(m1.finalDebt).toBe(0);
    expect(m1.fullyPaidByFund).toBe(true);

    // Member 2: play only = 100k, no fund
    const m2 = results.find((r) => r.memberId === 2)!;
    expect(m2.finalDebt).toBe(100000);
  });
});

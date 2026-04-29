/**
 * Scenario tests — realistic FWBB sessions với data đa dạng để catch
 * regression khi thay đổi logic cost-split, fund deduction, hoặc rounding.
 *
 * Mỗi scenario tái hiện 1 use case thực tế và check toàn bộ output:
 *   - playCostPerHead / dineCostPerHead chính xác (round up to 1k)
 *   - Tổng chia ≥ tổng chi phí thực (admin không thiệt)
 *   - Mọi giá trị tiền là integer
 *   - Conservation: deducted + remaining = original (fund deduction)
 */

import { describe, it, expect } from "vitest";
import {
  calculateSessionCosts,
  type AttendeeInput,
  type ShuttlecockInput,
} from "./cost-calculator";
import { calculateFundDeduction } from "./fund-core";
import { roundToThousand } from "./utils";

function member(id: number, play: boolean, dine: boolean): AttendeeInput {
  return {
    memberId: id,
    guestName: null,
    invitedById: null,
    isGuest: false,
    attendsPlay: play,
    attendsDine: dine,
  };
}

function guest(invitedBy: number, play: boolean, dine: boolean): AttendeeInput {
  return {
    memberId: null,
    guestName: `Khách của ${invitedBy}`,
    invitedById: invitedBy,
    isGuest: true,
    attendsPlay: play,
    attendsDine: dine,
  };
}

function assertAdminNotUnderpaid(
  result: ReturnType<typeof calculateSessionCosts>,
  courtPrice: number,
  diningBill: number,
) {
  // Tổng tất cả debts >= chi phí thực — đảm bảo admin không thiệt
  const collected = result.memberDebts.reduce((s, d) => s + d.totalAmount, 0);
  const expected = courtPrice + result.totalShuttlecockCost + diningBill;
  expect(collected).toBeGreaterThanOrEqual(expected);
}

function assertAllIntegers(result: ReturnType<typeof calculateSessionCosts>) {
  expect(Number.isInteger(result.playCostPerHead)).toBe(true);
  expect(Number.isInteger(result.dineCostPerHead)).toBe(true);
  expect(Number.isInteger(result.totalShuttlecockCost)).toBe(true);
  for (const d of result.memberDebts) {
    expect(Number.isInteger(d.playAmount)).toBe(true);
    expect(Number.isInteger(d.dineAmount)).toBe(true);
    expect(Number.isInteger(d.guestPlayAmount)).toBe(true);
    expect(Number.isInteger(d.guestDineAmount)).toBe(true);
    expect(Number.isInteger(d.totalAmount)).toBe(true);
  }
}

describe("Realistic FWBB scenarios", () => {
  // ─── Scenario 1: standard 8-player session, 1 court (200k), all dine, 6 quả 1 brand ───

  it("Scenario 1: 8 players + dining + 6 quả Yonex", () => {
    const attendees = Array.from({ length: 8 }, (_, i) =>
      member(i + 1, true, true),
    );
    const shuttle: ShuttlecockInput[] = [
      { quantityUsed: 6, pricePerTube: 120_000 }, // 60k → roundUp 60k
    ];
    const result = calculateSessionCosts(
      { courtPrice: 200_000, diningBill: 480_000 },
      attendees,
      shuttle,
    );

    expect(result.totalShuttlecockCost).toBe(60_000);
    // play = (200k+60k)/8 = 32500 → 33k each
    expect(result.playCostPerHead).toBe(33_000);
    // dine = 480k/8 = 60k
    expect(result.dineCostPerHead).toBe(60_000);
    // each member owes 33k+60k = 93k
    for (const d of result.memberDebts) {
      expect(d.totalAmount).toBe(93_000);
    }
    assertAllIntegers(result);
    assertAdminNotUnderpaid(result, 200_000, 480_000);
  });

  // ─── Scenario 2: 2 courts (extra 220k retail), 12 players, mixed dine ───

  it("Scenario 2: 12 players over 2 courts (420k), only 8 dine, 12 quả VS", () => {
    const attendees: AttendeeInput[] = Array.from({ length: 12 }, (_, i) =>
      member(i + 1, true, i < 8),
    );
    const shuttle: ShuttlecockInput[] = [
      { quantityUsed: 12, pricePerTube: 80_000 }, // 1 ống = 80k
    ];
    const result = calculateSessionCosts(
      { courtPrice: 420_000, diningBill: 640_000 },
      attendees,
      shuttle,
    );

    expect(result.totalShuttlecockCost).toBe(80_000);
    // play = (420k+80k)/12 = 41,666.67 → 42k
    expect(result.playCostPerHead).toBe(42_000);
    // dine = 640k/8 = 80k
    expect(result.dineCostPerHead).toBe(80_000);
    assertAllIntegers(result);
    assertAdminNotUnderpaid(result, 420_000, 640_000);
  });

  // ─── Scenario 3: Member 1 brings 2 guests, 5 members + 2 guests = 7 players ───

  it("Scenario 3: 5 members + 2 guests (invited by member 1), guest 1 also dines", () => {
    const attendees: AttendeeInput[] = [
      member(1, true, true),
      member(2, true, true),
      member(3, true, false),
      member(4, true, true),
      member(5, true, false),
      guest(1, true, true),
      guest(1, true, false),
    ];
    const result = calculateSessionCosts(
      { courtPrice: 280_000, diningBill: 280_000 },
      attendees,
      [],
    );
    // 7 players, 4 diners (m1, m2, m4, guest1)
    expect(result.totalPlayers).toBe(7);
    expect(result.totalDiners).toBe(4);
    // play = 280k/7 = 40k
    expect(result.playCostPerHead).toBe(40_000);
    // dine = 280k/4 = 70k
    expect(result.dineCostPerHead).toBe(70_000);

    const m1 = result.memberDebts.find((d) => d.memberId === 1)!;
    // m1: own play 40k + own dine 70k + 2 guest play (80k) + 1 guest dine (70k) = 260k
    expect(m1.playAmount).toBe(40_000);
    expect(m1.dineAmount).toBe(70_000);
    expect(m1.guestPlayAmount).toBe(80_000);
    expect(m1.guestDineAmount).toBe(70_000);
    expect(m1.totalAmount).toBe(260_000);
    assertAllIntegers(result);
    assertAdminNotUnderpaid(result, 280_000, 280_000);
  });

  // ─── Scenario 4: cost-rounding stress (small group, many tubes) ───

  it("Scenario 4: 3 players, 17 quả across 2 brands, awkward dining bill", () => {
    const attendees = Array.from({ length: 3 }, (_, i) =>
      member(i + 1, true, true),
    );
    const shuttle: ShuttlecockInput[] = [
      { quantityUsed: 11, pricePerTube: 145_000 }, // 11/12*145k = 132,917 → 133k
      { quantityUsed: 6, pricePerTube: 180_000 }, // 6/12*180k = 90k
    ];
    const result = calculateSessionCosts(
      { courtPrice: 200_000, diningBill: 175_000 },
      attendees,
      shuttle,
    );
    // shuttle total = 133k + 90k = 223k (sum-of-rounded-then-rounded)
    expect(result.totalShuttlecockCost).toBe(223_000);
    // play = (200k+223k)/3 = 141k → already exact
    expect(result.playCostPerHead).toBe(141_000);
    // dine = 175k/3 = 58.333k → 59k
    expect(result.dineCostPerHead).toBe(59_000);
    assertAllIntegers(result);
    assertAdminNotUnderpaid(result, 200_000, 175_000);
  });

  // ─── Scenario 5: only 1 player, no dining (worst-case efficiency) ───

  it("Scenario 5: 1 lonely player pays everything", () => {
    const result = calculateSessionCosts(
      { courtPrice: 200_000, diningBill: 0 },
      [member(1, true, false)],
      [{ quantityUsed: 6, pricePerTube: 120_000 }],
    );
    expect(result.memberDebts[0].totalAmount).toBe(260_000);
    assertAllIntegers(result);
  });

  // ─── Scenario 6: large odd-divisor session (rounding exposed) ───

  it("Scenario 6: 11 players → rounding catches 0.09k per head", () => {
    const attendees = Array.from({ length: 11 }, (_, i) =>
      member(i + 1, true, false),
    );
    const result = calculateSessionCosts(
      { courtPrice: 200_000, diningBill: 0 },
      attendees,
      [],
    );
    // 200k / 11 = 18,181.81 → 19k
    expect(result.playCostPerHead).toBe(19_000);
    // 11 * 19k = 209k > 200k → admin gets 9k extra (rounding buffer)
    const collected = result.memberDebts.reduce((s, d) => s + d.totalAmount, 0);
    expect(collected).toBe(209_000);
    expect(collected - 200_000).toBe(9_000);
  });
});

describe("Property: round-up always protects admin", () => {
  // Generate a bunch of synthetic data and assert admin invariant
  const playerCounts = [1, 2, 3, 5, 7, 11, 13, 17, 25];
  const courtPrices = [200_000, 220_000, 400_000, 550_000];
  const diningBills = [0, 100_000, 333_333, 700_000];

  it.each(
    playerCounts.flatMap((p) =>
      courtPrices.flatMap((c) => diningBills.map((d) => ({ p, c, d }))),
    ),
  )(
    "$p players, courtPrice=$c, dining=$d → admin not underpaid",
    ({ p, c, d }) => {
      const attendees = Array.from({ length: p }, (_, i) =>
        member(i + 1, true, d > 0),
      );
      const result = calculateSessionCosts(
        { courtPrice: c, diningBill: d },
        attendees,
        [],
      );
      const collected = result.memberDebts.reduce(
        (s, dd) => s + dd.totalAmount,
        0,
      );
      // Strict: collected >= c + d
      expect(collected).toBeGreaterThanOrEqual(c + d);
      // And the gap is at most (1k * activeBuckets) per head
      const maxExpectedSurplus = p * 1000 + (d > 0 ? p * 1000 : 0);
      expect(collected - (c + d)).toBeLessThanOrEqual(maxExpectedSurplus);
      assertAllIntegers(result);
    },
  );
});

describe("Property: fund deduction conservation", () => {
  it.each([
    { balance: 0, debt: 100_000 },
    { balance: 50_000, debt: 100_000 },
    { balance: 100_000, debt: 100_000 },
    { balance: 999_999, debt: 1_000_000 },
    { balance: 5_000_000, debt: 250_000 },
    { balance: 1, debt: 1 },
    { balance: 1, debt: 100_000 },
  ])("balance=$balance debt=$debt", ({ balance, debt }) => {
    const r = calculateFundDeduction(balance, debt);
    // Conservation
    expect(r.deductedFromFund + r.remainingDebt).toBe(debt);
    // Never deduct more than balance
    expect(r.deductedFromFund).toBeLessThanOrEqual(Math.max(0, balance));
    // Never deduct more than debt
    expect(r.deductedFromFund).toBeLessThanOrEqual(debt);
    expect(Number.isInteger(r.deductedFromFund)).toBe(true);
    expect(Number.isInteger(r.remainingDebt)).toBe(true);
  });
});

describe("Realistic combined: per-head debt is a round 1k multiple", () => {
  // Every member-facing amount must be a 1k multiple (so QR amount is clean)
  it.each([
    { courtPrice: 200_000, diningBill: 0, players: 7, diners: 0 },
    { courtPrice: 420_000, diningBill: 350_000, players: 9, diners: 5 },
    { courtPrice: 200_000, diningBill: 250_000, players: 4, diners: 4 },
    { courtPrice: 600_000, diningBill: 500_000, players: 13, diners: 7 },
  ])(
    "courtPrice=$courtPrice diningBill=$diningBill players=$players diners=$diners",
    ({ courtPrice, diningBill, players, diners }) => {
      const attendees = Array.from({ length: players }, (_, i) =>
        member(i + 1, true, i < diners),
      );
      const result = calculateSessionCosts(
        { courtPrice, diningBill },
        attendees,
        [],
      );
      for (const d of result.memberDebts) {
        expect(d.totalAmount % 1000).toBe(0);
        expect(d.playAmount % 1000).toBe(0);
        expect(d.dineAmount % 1000).toBe(0);
        // Verify equals round-up of the raw share
        expect(d.playAmount).toBe(roundToThousand(courtPrice / players));
      }
      // Check each diner got dine debt
      const dinerDebts = result.memberDebts.filter((d) => d.dineAmount > 0);
      expect(dinerDebts).toHaveLength(diners);
      if (diners > 0) {
        expect(result.dineCostPerHead).toBe(
          roundToThousand(diningBill / diners),
        );
      }
    },
  );
});

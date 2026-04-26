import { describe, it, expect } from "vitest";
import {
  calculateSessionCosts,
  type AttendeeInput,
  type ShuttlecockInput,
} from "./cost-calculator";

describe("calculateSessionCosts", () => {
  const makeAttendee = (
    memberId: number,
    play: boolean,
    dine: boolean,
    opts?: {
      isGuest?: boolean;
      invitedById?: number | null;
      guestName?: string;
    },
  ): AttendeeInput => ({
    memberId: opts?.isGuest ? null : memberId,
    guestName: opts?.guestName ?? null,
    invitedById: opts?.invitedById ?? null,
    isGuest: opts?.isGuest ?? false,
    attendsPlay: play,
    attendsDine: dine,
  });

  it("should calculate basic session with 4 players, no dining", () => {
    const attendees = [
      makeAttendee(1, true, false),
      makeAttendee(2, true, false),
      makeAttendee(3, true, false),
      makeAttendee(4, true, false),
    ];
    const result = calculateSessionCosts(
      { courtPrice: 400000, diningBill: 0 },
      attendees,
      [],
    );

    expect(result.totalPlayers).toBe(4);
    expect(result.totalDiners).toBe(0);
    expect(result.playCostPerHead).toBe(100000);
    expect(result.dineCostPerHead).toBe(0);
    expect(result.memberDebts).toHaveLength(4);
    expect(result.memberDebts[0].totalAmount).toBe(100000);
  });

  it("should split cost with shuttlecocks", () => {
    const attendees = [
      makeAttendee(1, true, false),
      makeAttendee(2, true, false),
    ];
    const shuttlecocks: ShuttlecockInput[] = [
      { quantityUsed: 12, pricePerTube: 120000 }, // 12 quả = 1 ống = 120,000
    ];
    const result = calculateSessionCosts(
      { courtPrice: 200000, diningBill: 0 },
      attendees,
      shuttlecocks,
    );

    // courtPrice(200k) + shuttlecock(120k) = 320k / 2 players = 160k
    expect(result.totalShuttlecockCost).toBe(120000);
    expect(result.totalPlayCost).toBe(320000);
    expect(result.playCostPerHead).toBe(160000);
  });

  it("should handle partial shuttlecock tubes", () => {
    const attendees = [
      makeAttendee(1, true, false),
      makeAttendee(2, true, false),
    ];
    const shuttlecocks: ShuttlecockInput[] = [
      { quantityUsed: 6, pricePerTube: 120000 }, // 6 quả = 0.5 ống = 60,000
    ];
    const result = calculateSessionCosts(
      { courtPrice: 200000, diningBill: 0 },
      attendees,
      shuttlecocks,
    );

    expect(result.totalShuttlecockCost).toBe(60000);
    expect(result.playCostPerHead).toBe(130000); // (200k + 60k) / 2 = 130k
  });

  it("should split dining separately from play", () => {
    const attendees = [
      makeAttendee(1, true, true),
      makeAttendee(2, true, true),
      makeAttendee(3, true, false),
    ];
    const result = calculateSessionCosts(
      { courtPrice: 300000, diningBill: 400000 },
      attendees,
      [],
    );

    expect(result.totalPlayers).toBe(3);
    expect(result.totalDiners).toBe(2);
    expect(result.playCostPerHead).toBe(100000); // 300k / 3
    expect(result.dineCostPerHead).toBe(200000); // 400k / 2

    // Member 1: play(100k) + dine(200k) = 300k
    const member1 = result.memberDebts.find((d) => d.memberId === 1)!;
    expect(member1.totalAmount).toBe(300000);

    // Member 3: play only = 100k
    const member3 = result.memberDebts.find((d) => d.memberId === 3)!;
    expect(member3.totalAmount).toBe(100000);
  });

  it("should charge guests to the inviting member", () => {
    const attendees: AttendeeInput[] = [
      makeAttendee(1, true, true),
      makeAttendee(2, true, false),
      {
        memberId: null,
        guestName: "Khách A",
        invitedById: 1,
        isGuest: true,
        attendsPlay: true,
        attendsDine: true,
      },
    ];
    const result = calculateSessionCosts(
      { courtPrice: 300000, diningBill: 200000 },
      attendees,
      [],
    );

    expect(result.totalPlayers).toBe(3); // 2 members + 1 guest
    expect(result.totalDiners).toBe(2); // member1 + guest
    expect(result.playCostPerHead).toBe(100000); // 300k / 3

    // Member 1: own play + own dine + guest play + guest dine
    const member1 = result.memberDebts.find((d) => d.memberId === 1)!;
    expect(member1.playAmount).toBe(100000);
    expect(member1.dineAmount).toBe(100000);
    expect(member1.guestPlayAmount).toBe(100000);
    expect(member1.guestDineAmount).toBe(100000);
    expect(member1.totalAmount).toBe(400000);
  });

  it("should round up to the next 1000 VND", () => {
    const attendees = [
      makeAttendee(1, true, false),
      makeAttendee(2, true, false),
      makeAttendee(3, true, false),
    ];
    const result = calculateSessionCosts(
      { courtPrice: 250000, diningBill: 0 }, // 250k / 3 = 83,333.33
      attendees,
      [],
    );

    expect(result.playCostPerHead).toBe(84000); // rounded up to protect admin cash flow
  });

  it("should not create debt for member who owes 0", () => {
    const attendees = [
      makeAttendee(1, true, false),
      makeAttendee(2, false, false), // doesn't play or dine → 0 debt
    ];
    const result = calculateSessionCosts(
      { courtPrice: 100000, diningBill: 0 },
      attendees,
      [],
    );

    expect(result.memberDebts).toHaveLength(1);
    expect(result.memberDebts[0].memberId).toBe(1);
  });

  it("should handle empty attendees", () => {
    const result = calculateSessionCosts(
      { courtPrice: 300000, diningBill: 200000 },
      [],
      [],
    );

    expect(result.totalPlayers).toBe(0);
    expect(result.totalDiners).toBe(0);
    expect(result.playCostPerHead).toBe(0);
    expect(result.dineCostPerHead).toBe(0);
    expect(result.memberDebts).toHaveLength(0);
  });

  it("should handle multiple shuttlecock brands", () => {
    const attendees = [
      makeAttendee(1, true, false),
      makeAttendee(2, true, false),
    ];
    const shuttlecocks: ShuttlecockInput[] = [
      { quantityUsed: 6, pricePerTube: 120000 }, // 60k
      { quantityUsed: 3, pricePerTube: 180000 }, // 45k
    ];
    const result = calculateSessionCosts(
      { courtPrice: 200000, diningBill: 0 },
      attendees,
      shuttlecocks,
    );

    // Shuttle cost: 60k + 45k = 105k
    expect(result.totalShuttlecockCost).toBe(105000);
    // Total play cost: 200k + 105k = 305k / 2 = 152,500 → round to 153k
    expect(result.playCostPerHead).toBe(153000);
  });

  // CRITICAL: Ensure all monetary values are integers
  it("should produce integer amounts for all debts", () => {
    const attendees = [
      makeAttendee(1, true, true),
      makeAttendee(2, true, true),
      makeAttendee(3, true, false),
    ];
    const shuttlecocks: ShuttlecockInput[] = [
      { quantityUsed: 7, pricePerTube: 145000 },
    ];
    const result = calculateSessionCosts(
      { courtPrice: 350000, diningBill: 275000 },
      attendees,
      shuttlecocks,
    );

    for (const debt of result.memberDebts) {
      expect(Number.isInteger(debt.playAmount)).toBe(true);
      expect(Number.isInteger(debt.dineAmount)).toBe(true);
      expect(Number.isInteger(debt.guestPlayAmount)).toBe(true);
      expect(Number.isInteger(debt.guestDineAmount)).toBe(true);
      expect(Number.isInteger(debt.totalAmount)).toBe(true);
    }
  });
});

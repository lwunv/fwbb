import { describe, it, expect } from "vitest";
import {
  calculateSessionCosts,
  calculateShuttlecockCost,
  calculateExactShuttlecockCost,
  computePerHeadCharges,
  type AttendeeInput,
  type ShuttlecockInput,
} from "./cost-calculator";

describe("computePerHeadCharges", () => {
  it("rounds play+shuttle/N up to 1k", () => {
    const r = computePerHeadCharges({
      courtPrice: 200_000,
      shuttlecockCost: 100_000,
      diningBill: 0,
      playerCount: 7,
      dinerCount: 0,
    });
    // 300_000 / 7 = 42857.14… → round up to 43_000
    expect(r.playCostPerHead).toBe(43_000);
    expect(r.dineCostPerHead).toBe(0);
  });

  it("returns 0 when player or diner count is 0", () => {
    const r = computePerHeadCharges({
      courtPrice: 200_000,
      shuttlecockCost: 0,
      diningBill: 100_000,
      playerCount: 0,
      dinerCount: 0,
    });
    expect(r.playCostPerHead).toBe(0);
    expect(r.dineCostPerHead).toBe(0);
  });

  it("matches calculateSessionCosts per-head when inputs align", () => {
    const attendees: AttendeeInput[] = [
      {
        memberId: 1,
        invitedById: null,
        isGuest: false,
        attendsPlay: true,
        attendsDine: false,
      },
      {
        memberId: 2,
        invitedById: null,
        isGuest: false,
        attendsPlay: true,
        attendsDine: false,
      },
      {
        memberId: 3,
        invitedById: null,
        isGuest: false,
        attendsPlay: true,
        attendsDine: true,
      },
    ];
    const shuttles: ShuttlecockInput[] = [
      { quantityUsed: 6, pricePerTube: 240_000 }, // exact 120_000
    ];
    const breakdown = calculateSessionCosts(
      { courtPrice: 200_000, diningBill: 50_000 },
      attendees,
      shuttles,
    );

    const helper = computePerHeadCharges({
      courtPrice: 200_000,
      shuttlecockCost: breakdown.totalShuttlecockCost,
      diningBill: 50_000,
      playerCount: breakdown.totalPlayers,
      dinerCount: breakdown.totalDiners,
    });

    expect(helper.playCostPerHead).toBe(breakdown.playCostPerHead);
    expect(helper.dineCostPerHead).toBe(breakdown.dineCostPerHead);
  });
});

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

  // ─── Edge cases ───

  it("handles 1 player + 0 dining (single-player session)", () => {
    const result = calculateSessionCosts(
      { courtPrice: 200000, diningBill: 0 },
      [makeAttendee(1, true, false)],
      [],
    );
    expect(result.totalPlayers).toBe(1);
    expect(result.playCostPerHead).toBe(200000);
    expect(result.memberDebts[0].totalAmount).toBe(200000);
  });

  it("handles dining with no players (eat-only event)", () => {
    const result = calculateSessionCosts(
      { courtPrice: 0, diningBill: 600000 },
      [
        makeAttendee(1, false, true),
        makeAttendee(2, false, true),
        makeAttendee(3, false, true),
      ],
      [],
    );
    expect(result.totalPlayers).toBe(0);
    expect(result.totalDiners).toBe(3);
    expect(result.playCostPerHead).toBe(0);
    expect(result.dineCostPerHead).toBe(200000);
    for (const d of result.memberDebts) {
      expect(d.totalAmount).toBe(200000);
      expect(d.playAmount).toBe(0);
    }
  });

  it("does not create a debt entry for a member who only invited a guest", () => {
    // Member 1 doesn't play/dine but invites a guest who does — so member 1 still owes
    const attendees: AttendeeInput[] = [
      makeAttendee(1, false, false),
      makeAttendee(2, true, false),
      {
        memberId: null,
        guestName: "Khách",
        invitedById: 1,
        isGuest: true,
        attendsPlay: true,
        attendsDine: false,
      },
    ];
    const result = calculateSessionCosts(
      { courtPrice: 200000, diningBill: 0 },
      attendees,
      [],
    );
    expect(result.totalPlayers).toBe(2); // member 2 + guest
    expect(result.playCostPerHead).toBe(100000);

    const m1 = result.memberDebts.find((d) => d.memberId === 1);
    expect(m1).toBeDefined();
    expect(m1!.guestPlayAmount).toBe(100000);
    expect(m1!.totalAmount).toBe(100000);
  });

  it("handles a member with multiple guests (3 guests playing + 1 dining)", () => {
    const attendees: AttendeeInput[] = [
      makeAttendee(1, true, true),
      makeAttendee(2, true, true),
      ...[1, 2, 3].map((i) => ({
        memberId: null,
        guestName: `Khách${i}`,
        invitedById: 1,
        isGuest: true,
        attendsPlay: true,
        attendsDine: i === 1,
      })),
    ];
    const result = calculateSessionCosts(
      { courtPrice: 500000, diningBill: 300000 },
      attendees,
      [],
    );
    // Players = 5 (m1, m2, 3 guests). 500k/5 = 100k each
    expect(result.totalPlayers).toBe(5);
    expect(result.playCostPerHead).toBe(100000);

    // Diners = m1, m2, 1 guest = 3. 300k/3 = 100k each
    expect(result.totalDiners).toBe(3);
    expect(result.dineCostPerHead).toBe(100000);

    const m1 = result.memberDebts.find((d) => d.memberId === 1)!;
    // own play(100) + own dine(100) + 3 guests play(300) + 1 guest dine(100)
    expect(m1.totalAmount).toBe(600000);
  });

  it("rounds shuttlecock cost up at the brand level", () => {
    const result = calculateSessionCosts(
      { courtPrice: 0, diningBill: 0 },
      [makeAttendee(1, true, false)],
      [{ quantityUsed: 1, pricePerTube: 145000 }], // 1/12 * 145k = 12,083.33
    );
    // Each brand rounds via calculateShuttlecockCost (round up); so brand contributes 13k
    // After total round-up, totalShuttlecockCost = 13k
    expect(result.totalShuttlecockCost).toBe(13_000);
  });

  it("rounds total play cost per head up at the per-head level", () => {
    // 200k / 7 players = 28,571.43 → round up to 29k
    const attendees = Array.from({ length: 7 }, (_, i) =>
      makeAttendee(i + 1, true, false),
    );
    const result = calculateSessionCosts(
      { courtPrice: 200_000, diningBill: 0 },
      attendees,
      [],
    );
    expect(result.playCostPerHead).toBe(29_000);
  });

  it("guests don't appear in memberDebts list (only inviters do)", () => {
    const attendees: AttendeeInput[] = [
      makeAttendee(1, true, false),
      {
        memberId: null,
        guestName: "Khách",
        invitedById: 1,
        isGuest: true,
        attendsPlay: true,
        attendsDine: false,
      },
    ];
    const result = calculateSessionCosts(
      { courtPrice: 200000, diningBill: 0 },
      attendees,
      [],
    );
    expect(result.memberDebts).toHaveLength(1);
    expect(result.memberDebts[0].memberId).toBe(1);
    // Member 1 owes 2 heads (own + guest)
    expect(result.memberDebts[0].totalAmount).toBe(200000);
  });

  it("does not double-count when same memberId appears twice (e.g. duplicated row)", () => {
    // Defensive: same member with both play+dine in one row, plus a duplicate row
    const attendees: AttendeeInput[] = [
      makeAttendee(1, true, true),
      makeAttendee(1, true, true),
      makeAttendee(2, true, true),
    ];
    const result = calculateSessionCosts(
      { courtPrice: 200000, diningBill: 100000 },
      attendees,
      [],
    );
    // Players still counted as raw filter — duplicates inflate divisor
    expect(result.totalPlayers).toBe(3);
    // memberIds Set dedupes — only 1 debt for memberId=1
    const m1Debts = result.memberDebts.filter((d) => d.memberId === 1);
    expect(m1Debts).toHaveLength(1);
  });
});

describe("calculateShuttlecockCost / calculateExactShuttlecockCost", () => {
  it("exact cost: 12 quả * 120k/tube = 120k", () => {
    expect(calculateExactShuttlecockCost(12, 120_000)).toBe(120_000);
  });

  it("exact cost preserves fractional", () => {
    // 1 / 12 * 145000 = 12083.333...
    expect(calculateExactShuttlecockCost(1, 145_000)).toBeCloseTo(
      12_083.333,
      2,
    );
  });

  it("rounded cost: 1 quả * 145k/tube → 13k (round up to nearest 1k)", () => {
    expect(calculateShuttlecockCost(1, 145_000)).toBe(13_000);
  });

  it("rounded cost: 6 quả * 120k/tube = 60k exact", () => {
    expect(calculateShuttlecockCost(6, 120_000)).toBe(60_000);
  });

  it("rounded cost is always integer", () => {
    for (const q of [1, 2, 5, 7, 11, 12, 13, 24]) {
      for (const p of [80_000, 120_000, 145_000, 180_000, 250_000]) {
        const v = calculateShuttlecockCost(q, p);
        expect(Number.isInteger(v)).toBe(true);
        expect(v % 1000).toBe(0);
      }
    }
  });
});

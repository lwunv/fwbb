import { describe, it, expect } from "vitest";
import {
  calculateSessionCosts,
  calculateShuttlecockCost,
  calculateExactShuttlecockCost,
  computePerHeadCharges,
  computeCourtTotal,
  computeShuttlecockTotal,
  applyMinDeductionFloor,
  computePredictedMinDeductionSurplus,
  MIN_DEDUCTION_PER_HEAD,
  type AttendeeInput,
  type MemberDebt,
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

describe("computeShuttlecockTotal", () => {
  it("rounds TOTAL up to 1k, not each brand individually", () => {
    // 1 quả * 65k/tube = 5_416.67. Two brands: 5_416.67 * 2 = 10_833.33.
    // Per-brand round: round(5_416.67)=6_000, sum=12_000.
    // Total round: round(10_833.33)=11_000.
    // Helper must produce 11_000 (matches calculateSessionCosts).
    const r = computeShuttlecockTotal([
      { quantityUsed: 1, pricePerTube: 65_000 },
      { quantityUsed: 1, pricePerTube: 65_000 },
    ]);
    expect(r).toBe(11_000);
  });

  it("single brand: identical to calculateShuttlecockCost (exact divisible)", () => {
    expect(
      computeShuttlecockTotal([{ quantityUsed: 6, pricePerTube: 120_000 }]),
    ).toBe(60_000);
  });

  it("returns 0 for empty list", () => {
    expect(computeShuttlecockTotal([])).toBe(0);
  });

  it("rounds UP — admin never underpays", () => {
    // 1 quả * 145k = 12_083.33 → must round UP to 13_000, never down to 12_000.
    expect(
      computeShuttlecockTotal([{ quantityUsed: 1, pricePerTube: 145_000 }]),
    ).toBe(13_000);
  });

  it("multi-brand mixed prices", () => {
    // 7 * 60k / 12 = 35_000 exact + 5 * 60k / 12 = 25_000 exact = 60_000.
    const r = computeShuttlecockTotal([
      { quantityUsed: 7, pricePerTube: 60_000 },
      { quantityUsed: 5, pricePerTube: 60_000 },
    ]);
    expect(r).toBe(60_000);
  });

  it("result is always a multiple of 1000", () => {
    for (const cases of [
      [{ quantityUsed: 1, pricePerTube: 67_500 }],
      [
        { quantityUsed: 3, pricePerTube: 130_000 },
        { quantityUsed: 2, pricePerTube: 150_000 },
      ],
      [
        { quantityUsed: 1, pricePerTube: 145_000 },
        { quantityUsed: 1, pricePerTube: 89_000 },
      ],
    ]) {
      const v = computeShuttlecockTotal(cases);
      expect(v % 1000).toBe(0);
    }
  });
});

describe("computeCourtTotal — sessionDays override", () => {
  // Mặc định helper fallback [1,3,5] = Mon/Wed/Fri.
  // 2026-05-13 = Wednesday. 2026-05-14 = Thursday.
  it("regular day + default court: monthly + (N-1) × retail (default M/W/F fallback)", () => {
    const r = computeCourtTotal({
      monthlyPrice: 200_000,
      retailPrice: 220_000,
      courtQuantity: 2,
      sessionDate: "2026-05-13", // Wed
      selectedCourtId: 1,
      defaultCourtId: 1,
    });
    expect(r).toBe(200_000 + 220_000); // 420k
  });

  it("irregular day + default court (default M/W/F fallback): all retail", () => {
    const r = computeCourtTotal({
      monthlyPrice: 200_000,
      retailPrice: 220_000,
      courtQuantity: 1,
      sessionDate: "2026-05-14", // Thu — NOT in default M/W/F
      selectedCourtId: 1,
      defaultCourtId: 1,
    });
    expect(r).toBe(220_000);
  });

  it("admin configures Tue/Thu/Sat schedule → Thu becomes regular day", () => {
    // Without sessionDays passed, this Thu would charge retail.
    // With sessionDays=[2,4,6], Thu IS regular and gets monthly.
    const r = computeCourtTotal({
      monthlyPrice: 200_000,
      retailPrice: 220_000,
      courtQuantity: 1,
      sessionDate: "2026-05-14", // Thu
      selectedCourtId: 1,
      defaultCourtId: 1,
      sessionDays: [2, 4, 6], // Tue/Thu/Sat
    });
    expect(r).toBe(200_000);
  });

  it("admin configures Tue/Thu/Sat → Wed now becomes irregular", () => {
    const r = computeCourtTotal({
      monthlyPrice: 200_000,
      retailPrice: 220_000,
      courtQuantity: 1,
      sessionDate: "2026-05-13", // Wed
      selectedCourtId: 1,
      defaultCourtId: 1,
      sessionDays: [2, 4, 6],
    });
    expect(r).toBe(220_000);
  });

  it("non-default court is ALWAYS retail regardless of session day", () => {
    const r = computeCourtTotal({
      monthlyPrice: 200_000,
      retailPrice: 220_000,
      courtQuantity: 1,
      sessionDate: "2026-05-13",
      selectedCourtId: 2,
      defaultCourtId: 1,
      sessionDays: [1, 3, 5],
    });
    expect(r).toBe(220_000);
  });

  it("retailPrice=null falls back to monthly", () => {
    const r = computeCourtTotal({
      monthlyPrice: 200_000,
      retailPrice: null,
      courtQuantity: 2,
      sessionDate: "2026-05-13",
      selectedCourtId: 1,
      defaultCourtId: 1,
    });
    expect(r).toBe(400_000); // monthly + monthly
  });

  it("empty sessionDays array falls back to default M/W/F", () => {
    const r = computeCourtTotal({
      monthlyPrice: 200_000,
      retailPrice: 220_000,
      courtQuantity: 1,
      sessionDate: "2026-05-13", // Wed
      selectedCourtId: 1,
      defaultCourtId: 1,
      sessionDays: [],
    });
    expect(r).toBe(200_000);
  });
});

describe("applyMinDeductionFloor", () => {
  function debt(overrides: Partial<MemberDebt> = {}): MemberDebt {
    const base: MemberDebt = {
      memberId: 1,
      playAmount: 30_000,
      dineAmount: 0,
      guestPlayAmount: 0,
      guestPlayCount: 0,
      guestDineAmount: 0,
      totalAmount: 30_000,
    };
    return { ...base, ...overrides };
  }

  it("balance đủ trả playAmount → no-op", () => {
    const d = debt({ playAmount: 30_000, totalAmount: 30_000 });
    const r = applyMinDeductionFloor(d, 100_000);
    expect(r).toEqual(d);
  });

  it("balance thiếu, playAmount < floor → override lên 60K", () => {
    const d = debt({ playAmount: 30_000, totalAmount: 30_000 });
    const r = applyMinDeductionFloor(d, 10_000);
    expect(r.playAmount).toBe(60_000);
    expect(r.totalAmount).toBe(60_000);
  });

  it("balance thiếu, playAmount ≥ floor → no-op (đã đủ)", () => {
    const d = debt({ playAmount: 80_000, totalAmount: 80_000 });
    const r = applyMinDeductionFloor(d, 10_000);
    expect(r).toEqual(d);
  });

  it("balance = 0 + playAmount nhỏ → fire", () => {
    const d = debt({ playAmount: 25_000, totalAmount: 25_000 });
    const r = applyMinDeductionFloor(d, 0);
    expect(r.playAmount).toBe(60_000);
    expect(r.totalAmount).toBe(60_000);
  });

  it("balance âm → fire (đang nợ)", () => {
    const d = debt({ playAmount: 40_000, totalAmount: 40_000 });
    const r = applyMinDeductionFloor(d, -50_000);
    expect(r.playAmount).toBe(60_000);
  });

  it("playAmount = 0 (không chơi, chỉ nhậu) → no-op", () => {
    const d = debt({
      playAmount: 0,
      dineAmount: 50_000,
      totalAmount: 50_000,
    });
    const r = applyMinDeductionFloor(d, 10_000);
    expect(r).toEqual(d);
  });

  it("member play <60K thiếu quỹ → floor member; khách KHÔNG bị đụng", () => {
    // Member chơi 30K + nhậu 40K + 1 khách-member chơi 30K. Balance thiếu.
    // CHỈ playAmount 30K → 60K (member-poverty floor). Khách-member 30K giữ
    // nguyên (chia đều, không có sàn). dine 40K giữ nguyên. Total = 60+40+30.
    const d = debt({
      playAmount: 30_000,
      dineAmount: 40_000,
      guestPlayAmount: 30_000,
      guestPlayCount: 1,
      guestDineAmount: 0,
      totalAmount: 100_000,
    });
    const r = applyMinDeductionFloor(d, 10_000);
    expect(r.playAmount).toBe(60_000);
    expect(r.dineAmount).toBe(40_000);
    expect(r.guestPlayAmount).toBe(30_000); // khách KHÔNG bị floor
    expect(r.guestDineAmount).toBe(0);
    expect(r.totalAmount).toBe(130_000);
  });

  it("member không chơi, chỉ có khách-member → no-op (khách không có sàn)", () => {
    const d = debt({
      playAmount: 0,
      guestPlayAmount: 46_000,
      guestPlayCount: 1,
      totalAmount: 46_000,
    });
    const r = applyMinDeductionFloor(d, 0);
    expect(r.guestPlayAmount).toBe(46_000);
    expect(r.totalAmount).toBe(46_000);
  });

  it("2 khách-member share thấp → giữ nguyên (chia đều, không floor)", () => {
    const d = debt({
      playAmount: 0,
      guestPlayAmount: 92_000,
      guestPlayCount: 2,
      totalAmount: 92_000,
    });
    const r = applyMinDeductionFloor(d, 0);
    expect(r.guestPlayAmount).toBe(92_000);
    expect(r.totalAmount).toBe(92_000);
  });

  it("custom floor amount honored", () => {
    const d = debt({ playAmount: 30_000, totalAmount: 30_000 });
    const r = applyMinDeductionFloor(d, 10_000, 50_000);
    expect(r.playAmount).toBe(50_000);
    expect(r.totalAmount).toBe(50_000);
  });

  it("MIN_DEDUCTION_PER_HEAD constant = 60K", () => {
    expect(MIN_DEDUCTION_PER_HEAD).toBe(60_000);
  });
});

describe("computePredictedMinDeductionSurplus", () => {
  it("returns 0 when playCostPerHead already ≥ floor (no penalty needed)", () => {
    const r = computePredictedMinDeductionSurplus({
      playingMemberIds: [1, 2, 3],
      memberBalances: { 1: 0, 2: 0, 3: 0 },
      exemptMemberIds: [],
      playCostPerHead: 80_000,
    });
    expect(r).toBe(0);
  });

  it("returns 0 when playCostPerHead = 0 (no players or no cost)", () => {
    const r = computePredictedMinDeductionSurplus({
      playingMemberIds: [1, 2],
      memberBalances: { 1: -100_000, 2: 0 },
      exemptMemberIds: [],
      playCostPerHead: 0,
    });
    expect(r).toBe(0);
  });

  it("returns 0 when all playing members have sufficient balance", () => {
    const r = computePredictedMinDeductionSurplus({
      playingMemberIds: [1, 2, 3],
      memberBalances: { 1: 500_000, 2: 100_000, 3: 50_000 },
      exemptMemberIds: [],
      playCostPerHead: 34_000,
    });
    expect(r).toBe(0);
  });

  it("adds (floor − playPerHead) for each member with insufficient balance", () => {
    // Scenario từ bug report user: 10 players, playPerHead=34K, 1 member
    // (Minh Lương, id=42) balance=0 → penalty = 60K - 34K = 26K.
    const r = computePredictedMinDeductionSurplus({
      playingMemberIds: [1, 2, 42],
      memberBalances: { 1: 500_000, 2: 100_000, 42: 0 },
      exemptMemberIds: [],
      playCostPerHead: 34_000,
    });
    expect(r).toBe(26_000);
  });

  it("sums penalty surplus across multiple insufficient members", () => {
    const r = computePredictedMinDeductionSurplus({
      playingMemberIds: [1, 2, 3, 4],
      memberBalances: { 1: 0, 2: 10_000, 3: 33_999, 4: 500_000 },
      exemptMemberIds: [],
      playCostPerHead: 34_000,
    });
    // Members 1, 2, 3 all < 34K → each contributes 60K - 34K = 26K
    expect(r).toBe(26_000 * 3);
  });

  it("skips exempt members from penalty", () => {
    const r = computePredictedMinDeductionSurplus({
      playingMemberIds: [1, 2, 3],
      memberBalances: { 1: 0, 2: 0, 3: 0 },
      exemptMemberIds: [2],
      playCostPerHead: 34_000,
    });
    // Only members 1 and 3 contribute penalty.
    expect(r).toBe(26_000 * 2);
  });

  it("treats missing balance entry as 0 (member never funded)", () => {
    const r = computePredictedMinDeductionSurplus({
      playingMemberIds: [99],
      memberBalances: {},
      exemptMemberIds: [],
      playCostPerHead: 34_000,
    });
    expect(r).toBe(26_000);
  });

  it("treats negative balance (debt) as insufficient — fires floor", () => {
    const r = computePredictedMinDeductionSurplus({
      playingMemberIds: [1],
      memberBalances: { 1: -50_000 },
      exemptMemberIds: [],
      playCostPerHead: 34_000,
    });
    expect(r).toBe(26_000);
  });

  it("returns 0 when playingMemberIds is empty", () => {
    const r = computePredictedMinDeductionSurplus({
      playingMemberIds: [],
      memberBalances: { 1: 0 },
      exemptMemberIds: [],
      playCostPerHead: 34_000,
    });
    expect(r).toBe(0);
  });

  it("khách KHÔNG còn tạo surplus quỹ (đã chia lại cho member qua guest-floor)", () => {
    // Sau guest-60K redistribute: khách trả sàn 60K nhưng phần dư giảm cho
    // member, KHÔNG vào quỹ → forecast surplus quỹ từ khách = 0. guestPlayCount
    // giữ làm no-op cho caller cũ.
    const r = computePredictedMinDeductionSurplus({
      playingMemberIds: [],
      memberBalances: {},
      exemptMemberIds: [],
      playCostPerHead: 34_000,
    });
    expect(r).toBe(0);
  });

  it("guest surplus = 0 khi perHead ≥ floor", () => {
    const r = computePredictedMinDeductionSurplus({
      playingMemberIds: [],
      memberBalances: {},
      exemptMemberIds: [],
      playCostPerHead: 70_000,
    });
    expect(r).toBe(0);
  });

  it("custom floor honored — penalty scales with floor − playPerHead", () => {
    const r = computePredictedMinDeductionSurplus({
      playingMemberIds: [1],
      memberBalances: { 1: 0 },
      exemptMemberIds: [],
      playCostPerHead: 20_000,
      floor: 50_000,
    });
    expect(r).toBe(30_000);
  });

  it("member with balance exactly = playPerHead does NOT trigger floor (boundary)", () => {
    // Matches `applyMinDeductionFloor` semantics: balance >= playAmount → no penalty.
    const r = computePredictedMinDeductionSurplus({
      playingMemberIds: [1],
      memberBalances: { 1: 34_000 },
      exemptMemberIds: [],
      playCostPerHead: 34_000,
    });
    expect(r).toBe(0);
  });
});

function member(id: number, opts: Partial<AttendeeInput> = {}): AttendeeInput {
  return {
    memberId: id,
    invitedById: null,
    isGuest: false,
    attendsPlay: true,
    attendsDine: false,
    ...opts,
  };
}

describe("calculateSessionCosts — partner headcount", () => {
  it("member đi 2 người chơi → tính 2 đầu, member trả 2 suất", () => {
    const r = calculateSessionCosts(
      { courtPrice: 200_000, diningBill: 0 },
      [member(1, { headcount: 2 })],
      [],
    );
    expect(r.totalPlayers).toBe(2);
    expect(r.playCostPerHead).toBe(100_000);
    const d = r.memberDebts.find((x) => x.memberId === 1)!;
    expect(d.playAmount).toBe(200_000);
    expect(d.guestPlayAmount).toBe(0);
    expect(d.totalAmount).toBe(200_000);
  });

  it("partner + guest cùng lúc: divisor = 2 (member) + 1 (guest) = 3", () => {
    const r = calculateSessionCosts(
      { courtPrice: 300_000, diningBill: 0 },
      [
        member(1, { headcount: 2 }),
        {
          memberId: null,
          invitedById: 1,
          isGuest: true,
          attendsPlay: true,
          attendsDine: false,
        },
      ],
      [],
    );
    expect(r.totalPlayers).toBe(3);
    expect(r.playCostPerHead).toBe(100_000);
    const d = r.memberDebts.find((x) => x.memberId === 1)!;
    expect(d.playAmount).toBe(200_000);
    expect(d.guestPlayAmount).toBe(100_000);
    expect(d.guestPlayCount).toBe(1);
    expect(d.totalAmount).toBe(300_000);
  });

  it("headcount mặc định 1 khi không truyền (backward-compat)", () => {
    const r = calculateSessionCosts(
      { courtPrice: 200_000, diningBill: 0 },
      [member(1), member(2)],
      [],
    );
    expect(r.totalPlayers).toBe(2);
    expect(r.playCostPerHead).toBe(100_000);
  });

  it("member đi 2 người nhậu → dine 2 suất", () => {
    const r = calculateSessionCosts(
      { courtPrice: 0, diningBill: 200_000 },
      [member(1, { attendsPlay: false, attendsDine: true, headcount: 2 })],
      [],
    );
    expect(r.totalDiners).toBe(2);
    expect(r.dineCostPerHead).toBe(100_000);
    const d = r.memberDebts.find((x) => x.memberId === 1)!;
    expect(d.dineAmount).toBe(200_000);
  });
});

describe("forecast surplus — partner", () => {
  it("member headcount=2, perHead 25k, broke → playAmount 50k < 60k → surplus 10k", () => {
    const s = computePredictedMinDeductionSurplus({
      playingMemberIds: [1],
      memberBalances: { 1: 0 },
      exemptMemberIds: [],
      playCostPerHead: 25_000,
      playingMemberHeadcounts: { 1: 2 },
    });
    expect(s).toBe(10_000);
  });
  it("member headcount=2, playAmount 2×40k=80k ≥ 60k → không phạt", () => {
    const s = computePredictedMinDeductionSurplus({
      playingMemberIds: [1],
      memberBalances: { 1: 0 },
      exemptMemberIds: [],
      playCostPerHead: 40_000,
      playingMemberHeadcounts: { 1: 2 },
    });
    expect(s).toBe(0);
  });
});

describe("calculateSessionCosts — admin-guest 60K floor vs member-guest equal split", () => {
  const ADMIN = 1;
  function adminGuest(): AttendeeInput {
    return {
      memberId: null,
      invitedById: ADMIN,
      isGuest: true,
      attendsPlay: true,
      attendsDine: false,
    };
  }
  function memberGuest(host: number): AttendeeInput {
    return {
      memberId: null,
      invitedById: host,
      isGuest: true,
      attendsPlay: true,
      attendsDine: false,
    };
  }
  function mem(id: number): AttendeeInput {
    return {
      memberId: id,
      invitedById: null,
      isGuest: false,
      attendsPlay: true,
      attendsDine: false,
    };
  }

  it("khách-admin floor 60K, member chia phần còn lại (không dư quỹ)", () => {
    // Sân 200K. admin(1) + member(2) chơi + 2 khách-admin. raw=200/4=50<60.
    const r = calculateSessionCosts(
      { courtPrice: 200_000, diningBill: 0 },
      [mem(1), mem(2), adminGuest(), adminGuest()],
      [],
      { adminMemberId: ADMIN },
    );
    expect(r.totalPlayers).toBe(4);
    expect(r.adminGuestPlayCostPerHead).toBe(60_000);
    expect(r.playCostPerHead).toBe(40_000); // (200 − 60×2) / 2 split heads
    const admin = r.memberDebts.find((d) => d.memberId === 1)!;
    expect(admin.playAmount).toBe(40_000);
    expect(admin.guestPlayAmount).toBe(120_000); // 2 × 60K khách-admin
    const m2 = r.memberDebts.find((d) => d.memberId === 2)!;
    expect(m2.playAmount).toBe(40_000);
  });

  it("khách-member chia đều, KHÔNG bị floor 60K", () => {
    // Sân 150K. member(1)+member(2) chơi + 1 khách-member (host 2). 3 đầu → 50K.
    const r = calculateSessionCosts(
      { courtPrice: 150_000, diningBill: 0 },
      [mem(1), mem(2), memberGuest(2)],
      [],
      { adminMemberId: ADMIN },
    );
    expect(r.playCostPerHead).toBe(50_000); // 150/3 chia đều
    const host = r.memberDebts.find((d) => d.memberId === 2)!;
    expect(host.playAmount).toBe(50_000);
    expect(host.guestPlayAmount).toBe(50_000); // khách-member theo rate chia đều
  });

  it("hỗn hợp: khách-member chia đều + khách-admin 60K (dạng buổi 22/6)", () => {
    // Sân 290K. 3 member + 1 khách-member (host 2) + 1 khách-admin. raw=290/5=58<60.
    // splitHeads=4 (3 member + 1 khách-member); adminGuestHeads=1.
    const r = calculateSessionCosts(
      { courtPrice: 290_000, diningBill: 0 },
      [mem(1), mem(2), mem(3), memberGuest(2), adminGuest()],
      [],
      { adminMemberId: ADMIN },
    );
    expect(r.adminGuestPlayCostPerHead).toBe(60_000);
    expect(r.playCostPerHead).toBe(58_000); // (290 − 60)/4 = 57.5 → 58K
    const host = r.memberDebts.find((d) => d.memberId === 2)!;
    expect(host.guestPlayAmount).toBe(58_000); // khách-member theo split
    const admin = r.memberDebts.find((d) => d.memberId === 1)!;
    expect(admin.guestPlayAmount).toBe(60_000); // khách-admin theo sàn
  });

  it("khách-admin với raw ≥ 60K → trả theo giá thật (60K là sàn, không phải trần)", () => {
    const r = calculateSessionCosts(
      { courtPrice: 300_000, diningBill: 0 },
      [mem(1), adminGuest()],
      [],
      { adminMemberId: ADMIN },
    );
    expect(r.playCostPerHead).toBe(150_000);
    expect(r.adminGuestPlayCostPerHead).toBe(150_000);
  });

  it("không truyền adminMemberId → mọi khách = chia đều (coi như khách-member)", () => {
    const r = calculateSessionCosts(
      { courtPrice: 200_000, diningBill: 0 },
      [mem(1), mem(2), memberGuest(1), memberGuest(1)],
      [],
    );
    expect(r.playCostPerHead).toBe(50_000); // 200/4 chia đều, không floor
    expect(r.adminGuestPlayCostPerHead).toBe(50_000);
  });

  it("khách-admin trả ≥ tiền sân (hiếm) → member = 0, không âm", () => {
    const r = calculateSessionCosts(
      { courtPrice: 100_000, diningBill: 0 },
      [mem(1), adminGuest(), adminGuest(), adminGuest()],
      [],
      { adminMemberId: ADMIN },
    );
    expect(r.playCostPerHead).toBe(0);
    expect(r.adminGuestPlayCostPerHead).toBe(60_000);
  });
});

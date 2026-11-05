import { describe, expect, it } from "vitest";
import {
  computeExchangeFees,
  computeLockedFees,
  depositSettlement,
  exchangeFeeEstimate,
  registrationFee,
  registrationSettlement,
  type ExchangeFeeConfig,
} from "./exchange-fee";
import {
  computeGroupPlayRates,
  GROUP_KEYS,
  type GroupKey,
  type GroupPolicy,
} from "./group-policy";

const base: ExchangeFeeConfig = {
  feeMode: "split_equal",
  feeAmountMale: null,
  feeAmountFemale: null,
  feeFemalePercent: null,
  estimatedTotalCost: null,
  minHeads: null,
  hostHeads: 1,
};
const cfg = (o: Partial<ExchangeFeeConfig>): ExchangeFeeConfig => ({
  ...base,
  ...o,
});

describe("computeExchangeFees", () => {
  it("fixed: 80K for everyone regardless of heads", () => {
    const c = cfg({ feeMode: "fixed", feeAmountMale: 80_000 });
    expect(computeExchangeFees(c, { male: 0, female: 0 })).toEqual({
      male: 80_000,
      female: 80_000,
    });
    expect(computeExchangeFees(c, { male: 7, female: 3 })).toEqual({
      male: 80_000,
      female: 80_000,
    });
  });

  it("fixed_gender: 100K male, 80K female, never averaged", () => {
    const c = cfg({
      feeMode: "fixed_gender",
      feeAmountMale: 100_000,
      feeAmountFemale: 80_000,
    });
    expect(computeExchangeFees(c, { male: 1, female: 9 })).toEqual({
      male: 100_000,
      female: 80_000,
    });
    expect(computeExchangeFees(c, { male: 0, female: 0 })).toEqual({
      male: 100_000,
      female: 80_000,
    });
  });

  it("split_equal: 600K over 5 registered + 1 host = 100K", () => {
    const c = cfg({ estimatedTotalCost: 600_000, hostHeads: 1 });
    expect(computeExchangeFees(c, { male: 3, female: 2 })).toEqual({
      male: 100_000,
      female: 100_000,
    });
  });

  it("split_equal: 500K over 3 heads rounds up to 167K", () => {
    const c = cfg({ estimatedTotalCost: 500_000, hostHeads: 0 });
    expect(computeExchangeFees(c, { male: 2, female: 1 })).toEqual({
      male: 167_000,
      female: 167_000,
    });
  });

  it("split_female_discount percent: equals a direct computeGroupPlayRates call with the same policy", () => {
    const c = cfg({
      feeMode: "split_female_discount",
      estimatedTotalCost: 700_000,
      feeFemalePercent: 70,
      hostHeads: 1,
    });
    const equal: GroupPolicy = { mode: "equal", amount: 0, capAtEqual: false };
    const policies = {} as Record<GroupKey, GroupPolicy>;
    for (const k of GROUP_KEYS) policies[k] = equal;
    policies.memberFemale = {
      mode: "percent",
      amount: 0,
      capAtEqual: false,
      percent: 70,
    };
    const heads = {} as Record<GroupKey, number>;
    for (const k of GROUP_KEYS) heads[k] = 0;
    heads.member = 4 + 1;
    heads.memberFemale = 3;
    const direct = computeGroupPlayRates({
      totalPlayCost: 700_000,
      headsByGroup: heads,
      policies,
    });
    const got = computeExchangeFees(c, { male: 4, female: 3 });
    expect(got).toEqual({ male: direct.member, female: direct.memberFemale });
    // Worked by hand: weights 5*100 + 3*70 = 710; 70,000,000 / 710 = 98,591.5
    // so men pay 99K; women pay 70% of that share (69,014) which rounds to 70K.
    expect(got).toEqual({ male: 99_000, female: 70_000 });
  });

  it("split_female_discount fixed female capped at equal share", () => {
    const lowFixed = cfg({
      feeMode: "split_female_discount",
      estimatedTotalCost: 600_000,
      feeAmountFemale: 50_000,
      hostHeads: 1,
    });
    // Women pay 50K flat; 550K left over 5 men + host = 91,667 -> 92K.
    expect(computeExchangeFees(lowFixed, { male: 5, female: 1 })).toEqual({
      male: 92_000,
      female: 50_000,
    });
    const highFixed = { ...lowFixed, feeAmountFemale: 150_000 };
    // 150K is above the equal share (600K / 7 = 85,714 -> 86K): capped.
    expect(computeExchangeFees(highFixed, { male: 5, female: 1 })).toEqual({
      male: 86_000,
      female: 86_000,
    });
  });

  it("0 registered heads puts the cost on host heads; 0 host heads and 0 registered returns 0", () => {
    expect(
      computeExchangeFees(cfg({ estimatedTotalCost: 400_000, hostHeads: 2 }), {
        male: 0,
        female: 0,
      }),
    ).toEqual({ male: 200_000, female: 200_000 });
    expect(
      computeExchangeFees(cfg({ estimatedTotalCost: 400_000, hostHeads: 0 }), {
        male: 0,
        female: 0,
      }),
    ).toEqual({ male: 0, female: 0 });
  });

  it("all-female split", () => {
    const c = cfg({ estimatedTotalCost: 300_000, hostHeads: 0 });
    expect(computeExchangeFees(c, { male: 0, female: 3 })).toEqual({
      male: 100_000,
      female: 100_000,
    });
    const d = cfg({
      feeMode: "split_female_discount",
      feeFemalePercent: 50,
      estimatedTotalCost: 300_000,
      hostHeads: 0,
    });
    // Only women present at 50%: the whole pool is women, they carry it all.
    expect(computeExchangeFees(d, { male: 0, female: 3 }).female).toBe(100_000);
  });
});

describe("exchangeFeeEstimate", () => {
  it("split_equal estimate uses minHeads male + host heads; 3 real men exceed it", () => {
    const c = cfg({ estimatedTotalCost: 600_000, minHeads: 5, hostHeads: 1 });
    expect(exchangeFeeEstimate(c)).toEqual({ male: 100_000, female: 100_000 });
    // 3 men + host = 4 heads: 150K, above the 100K estimate.
    expect(computeExchangeFees(c, { male: 3, female: 0 }).male).toBe(150_000);
  });

  it("split_female_discount fixed female estimate: fixed amount capped at the equal share", () => {
    const c = cfg({
      feeMode: "split_female_discount",
      estimatedTotalCost: 600_000,
      minHeads: 5,
      hostHeads: 1,
      feeAmountFemale: 50_000,
    });
    // 600K / (5 men + host) = 100K for men; women pay their fixed 50K.
    expect(exchangeFeeEstimate(c)).toEqual({ male: 100_000, female: 50_000 });
    // 150K is above the 100K equal share, so women are capped at 100K.
    expect(exchangeFeeEstimate({ ...c, feeAmountFemale: 150_000 })).toEqual({
      male: 100_000,
      female: 100_000,
    });
  });

  it("fixed modes estimate to the fixed numbers themselves", () => {
    expect(
      exchangeFeeEstimate(cfg({ feeMode: "fixed", feeAmountMale: 80_000 })),
    ).toEqual({ male: 80_000, female: 80_000 });
    expect(
      exchangeFeeEstimate(
        cfg({
          feeMode: "fixed_gender",
          feeAmountMale: 100_000,
          feeAmountFemale: 80_000,
        }),
      ),
    ).toEqual({ male: 100_000, female: 80_000 });
  });
});

describe("registrationFee", () => {
  it("multiplies each gender's rate by its head count", () => {
    expect(
      registrationFee(
        { male: 100_000, female: 70_000 },
        { maleCount: 2, femaleCount: 1 },
      ),
    ).toBe(270_000);
  });
});

describe("computeLockedFees", () => {
  const reg = (
    id: number,
    status: string,
    maleCount: number,
    femaleCount = 0,
    waived = false,
  ) => ({ id, status, maleCount, femaleCount, waived });

  it("split_female_discount with minHeads reached but 2 women present reports aboveEstimate", () => {
    const c = cfg({
      feeMode: "split_female_discount",
      estimatedTotalCost: 600_000,
      feeFemalePercent: 50,
      minHeads: 5,
      hostHeads: 1,
    });
    // Estimate: 5 men + host, weights 600 -> men 100K, women 50K.
    expect(exchangeFeeEstimate(c)).toEqual({ male: 100_000, female: 50_000 });
    // Real: 3 men + host (4*100) + 2 women (2*50) = 500 -> men 120K, women 60K.
    const out = computeLockedFees(c, [
      reg(1, "approved", 1),
      reg(2, "approved", 1),
      reg(3, "approved", 1, 2),
    ]);
    expect(out.rates).toEqual({ male: 120_000, female: 60_000 });
    expect(out.aboveEstimate).toBe(true);
    expect(out.chargedHeads).toBe(5);
    expect(out.fees).toEqual([
      { id: 1, amount: 120_000 },
      { id: 2, amount: 120_000 },
      { id: 3, amount: 120_000 + 2 * 60_000 },
    ]);
  });

  it("no_show and late_cancelled charged unless waived; waived leave the divisor", () => {
    const c = cfg({ estimatedTotalCost: 600_000, hostHeads: 1 });
    const out = computeLockedFees(c, [
      reg(1, "approved", 1),
      reg(2, "no_show", 1),
      reg(3, "late_cancelled", 1),
      reg(4, "approved", 1, 0, true),
      reg(5, "cancelled", 1),
      reg(6, "pending", 1),
      reg(7, "rejected", 1),
    ]);
    // 3 charged men + 1 host = 4 heads: 150K each.
    expect(out.rates).toEqual({ male: 150_000, female: 150_000 });
    expect(out.chargedHeads).toBe(3);
    expect(out.fees).toEqual([
      { id: 1, amount: 150_000 },
      { id: 2, amount: 150_000 },
      { id: 3, amount: 150_000 },
      { id: 4, amount: 0 },
      { id: 5, amount: 0 },
      { id: 6, amount: 0 },
      { id: 7, amount: 0 },
    ]);
  });

  it("fixed modes are never above estimate", () => {
    const c = cfg({ feeMode: "fixed", feeAmountMale: 80_000, minHeads: 1 });
    const out = computeLockedFees(c, [reg(1, "approved", 5, 5)]);
    expect(out.aboveEstimate).toBe(false);
    expect(out.fees[0].amount).toBe(800_000);
  });

  it("is JSON-safe (arrays, no Map)", () => {
    const out = computeLockedFees(cfg({ estimatedTotalCost: 100_000 }), [
      reg(1, "approved", 1),
    ]);
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });
});

describe("depositSettlement", () => {
  it("covers lower fee, waived (fee 0), no fee yet, equal, higher fee", () => {
    const dep = 50_000;
    const run = (depositPaid: boolean, feeAmount: number | null) =>
      depositSettlement({ depositPaid, feeAmount }, dep);
    // Lower fee: the difference comes back.
    expect(run(true, 30_000)).toEqual({ remaining: 0, refundDue: 20_000 });
    // Waived: fee 0, the whole deposit comes back.
    expect(run(true, 0)).toEqual({ remaining: 0, refundDue: 50_000 });
    // No fee yet counts as 0.
    expect(run(true, null)).toEqual({ remaining: 0, refundDue: 50_000 });
    // Equal.
    expect(run(true, 50_000)).toEqual({ remaining: 0, refundDue: 0 });
    // Higher fee: pay the rest.
    expect(run(true, 80_000)).toEqual({ remaining: 30_000, refundDue: 0 });
    // Deposit never paid: full fee remains, nothing to refund.
    expect(run(false, 80_000)).toEqual({ remaining: 80_000, refundDue: 0 });
  });
});

describe("registrationSettlement", () => {
  const reg = (o: {
    status: string;
    depositPaid?: boolean;
    feeAmount?: number | null;
    paid?: boolean;
    paidAmount?: number | null;
  }) => ({
    depositPaid: false,
    feeAmount: null,
    paid: false,
    paidAmount: null,
    ...o,
  });

  it("a non-chargeable status counts as no fee: cancelled or rejected after lock owe nothing and get back what they paid (R22)", () => {
    // Locked at 80K, deposit 30K paid, then a plain cancel: nothing owed, deposit back.
    expect(
      registrationSettlement(
        reg({ status: "cancelled", depositPaid: true, feeAmount: 80_000 }),
        30_000,
        "locked",
      ),
    ).toMatchObject({ remaining: 0, refundDue: 30_000, received: 30_000 });
    // Paid 80K in full, then rejected after a reopen: the full 80K comes back.
    expect(
      registrationSettlement(
        reg({
          status: "rejected",
          depositPaid: true,
          feeAmount: 80_000,
          paid: true,
          paidAmount: 80_000,
        }),
        30_000,
        "open",
      ),
    ).toMatchObject({ remaining: 0, refundDue: 80_000, received: 80_000 });
    // Same row while approved still owes 50K over the deposit.
    expect(
      registrationSettlement(
        reg({ status: "approved", depositPaid: true, feeAmount: 80_000 }),
        30_000,
        "locked",
      ),
    ).toMatchObject({ remaining: 50_000, refundDue: 0, received: 30_000 });
    // Chargeable non-attendance keeps the fee.
    for (const status of ["no_show", "late_cancelled"])
      expect(
        registrationSettlement(reg({ status, feeAmount: 80_000 }), 0, "locked"),
      ).toMatchObject({ remaining: 80_000, refundDue: 0, received: 0 });
  });

  it("received is what the host holds: paidAmount when paid, else the deposit when paid, else 0", () => {
    const r = (o: Parameters<typeof reg>[0]) =>
      registrationSettlement(reg(o), 30_000, "locked").received;
    expect(r({ status: "approved", feeAmount: 80_000 })).toBe(0);
    expect(
      r({ status: "approved", depositPaid: true, feeAmount: 80_000 }),
    ).toBe(30_000);
    expect(
      r({
        status: "approved",
        depositPaid: true,
        feeAmount: 80_000,
        paid: true,
        paidAmount: 75_000,
      }),
    ).toBe(75_000);
    // Legacy paid row without paidAmount falls back to the locked fee.
    expect(r({ status: "approved", feeAmount: 80_000, paid: true })).toBe(
      80_000,
    );
  });
});

describe("integer safety", () => {
  it("every returned amount is an integer", () => {
    // Tiny deterministic PRNG (mulberry32) so failures reproduce.
    let s = 20261105;
    const rnd = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const int = (max: number) => Math.floor(rnd() * (max + 1));
    const modes = [
      "fixed",
      "fixed_gender",
      "split_equal",
      "split_female_discount",
    ] as const;
    const statuses = [
      "pending",
      "approved",
      "rejected",
      "waitlist",
      "cancelled",
      "late_cancelled",
      "no_show",
    ];
    for (let i = 0; i < 200; i++) {
      const c: ExchangeFeeConfig = {
        feeMode: modes[int(3)],
        feeAmountMale: rnd() < 0.2 ? null : int(2_000_000),
        feeAmountFemale: rnd() < 0.2 ? null : int(2_000_000),
        feeFemalePercent: rnd() < 0.4 ? null : int(100),
        estimatedTotalCost: rnd() < 0.1 ? null : int(50_000_000),
        minHeads: rnd() < 0.3 ? null : int(60),
        hostHeads: int(10),
      };
      const regs = Array.from({ length: int(12) }, (_, k) => ({
        id: k + 1,
        status: statuses[int(statuses.length - 1)],
        maleCount: int(3),
        femaleCount: int(3),
        waived: rnd() < 0.2,
      }));
      const out = computeLockedFees(c, regs);
      const est = exchangeFeeEstimate(c);
      const all = [
        out.rates.male,
        out.rates.female,
        est.male,
        est.female,
        out.chargedHeads,
        ...out.fees.map((f) => f.amount),
      ];
      for (const n of all) {
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(0);
      }
      const dep = depositSettlement(
        { depositPaid: rnd() < 0.5, feeAmount: out.fees[0]?.amount ?? null },
        int(500_000),
      );
      expect(Number.isInteger(dep.remaining)).toBe(true);
      expect(Number.isInteger(dep.refundDue)).toBe(true);
    }
  });
});

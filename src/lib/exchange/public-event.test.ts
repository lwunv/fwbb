import { describe, it, expect } from "vitest";
import {
  PUBLIC_EXCHANGE_EVENT_KEYS,
  toPublicExchangeEvent,
  vnTimeOfDay,
  type RegLike,
} from "./public-event";

const event = {
  id: 7,
  publicCode: "abc123xyz9",
  idempotencyKey: "secret-key",
  hostMemberId: 3,
  venueId: 1,
  title: "Giao luu",
  description: null,
  startAt: "2099-01-01T12:00:00.000Z",
  endAt: "2099-01-01T14:00:00.000Z",
  skillMin: null,
  skillMax: null,
  slotsTotal: 10,
  femaleReservedSlots: 2,
  reserveReleaseAt: null,
  hostHeads: 1,
  shuttleType: null,
  feeMode: "fixed",
  feeAmountMale: 50_000,
  feeAmountFemale: null,
  feeFemalePercent: null,
  estimatedTotalCost: null,
  minHeads: null,
  depositAmount: 20_000,
  registerDeadline: "2099-01-01T10:00:00.000Z",
  cancelDeadline: "2099-01-01T10:00:00.000Z",
  autoApprove: false,
  allowPlusOnes: false,
  payoutBankBin: "970436",
  payoutAccountNo: "0123456789",
  payoutAccountName: "HOST",
  hostContact: "0912345678",
  zaloGroupLink: "https://zalo.me/g/x",
  status: "open",
  lockCount: 0,
  lockedAt: null,
  doneAt: null,
  cancelledAt: null,
  hiddenAt: null,
  createdAt: "2026-11-05T00:00:00.000Z",
  updatedAt: "2026-11-05T00:00:00.000Z",
} as const;

const venue = {
  id: 1,
  name: "Court",
  address: "1 Street",
  areaLabel: "Q1",
  lat: 10,
  lng: 106,
  mapLink: null,
  courtCount: 4,
  openHours: null,
  amenities: "[]",
  phone: "0900000000",
  refPricePerHour: null,
  photoLink: null,
  status: "approved",
  submittedByMemberId: 9,
  approvedAt: null,
  createdAt: null,
  updatedAt: null,
} as const;

const regs: RegLike[] = [
  {
    id: 1,
    status: "approved",
    maleCount: 2,
    femaleCount: 1,
    waitlistPos: null,
    feeWaived: false,
  },
  {
    id: 2,
    status: "pending",
    maleCount: 1,
    femaleCount: 0,
    waitlistPos: null,
    feeWaived: false,
  },
];

const host = { name: "H", avatarUrl: null, avatarKey: null };
const now = new Date("2026-11-05T00:00:00Z");

describe("toPublicExchangeEvent", () => {
  it("toPublicExchangeEvent has exactly PUBLIC_EXCHANGE_EVENT_KEYS, no phone/email/payout/contact", () => {
    const out = toPublicExchangeEvent({
      event: event as never,
      venue: venue as never,
      host,
      regs,
      attendeeAvatars: [],
      now,
    });
    expect(Object.keys(out).sort()).toEqual(
      [...PUBLIC_EXCHANGE_EVENT_KEYS].sort(),
    );
    const json = JSON.stringify(out);
    for (const leak of [
      "0912345678",
      "0900000000",
      "zalo.me",
      "0123456789",
      "970436",
      "secret-key",
      "hostMemberId",
      "submittedBy",
    ]) {
      expect(json).not.toContain(leak);
    }
    expect(Object.keys(out.venue).sort()).toEqual(
      ["address", "areaLabel", "id", "lat", "lng", "mapLink", "name"].sort(),
    );
    // 4 heads held of 10; 2 reserved for women, 3 men in: men can still take 8 - 3 = 5 of the 6 free.
    expect(out.counts).toEqual({
      approvedHeads: 3,
      pendingHeads: 1,
      waitlistHeads: 0,
      freeTotal: 6,
      freeFemaleOnly: 1,
    });
    expect(out.fee).toEqual({ kind: "fixed", male: 50_000, female: 50_000 });
  });

  it("split fee carries estimate, current and the cap flag", () => {
    const out = toPublicExchangeEvent({
      event: {
        ...event,
        feeMode: "split_equal",
        feeAmountMale: null,
        estimatedTotalCost: 600_000,
        minHeads: 5,
      } as never,
      venue: venue as never,
      host,
      regs,
      attendeeAvatars: [],
      now,
    });
    expect(out.fee.kind).toBe("split");
    if (out.fee.kind === "split") {
      expect(out.fee.estimateIsCap).toBe(true);
      expect(out.fee.minHeads).toBe(5);
      expect(out.fee.currentHeads).toBe(4);
      // The host counts in the divisor: 600k / (5 + 1).
      expect(out.fee.estimate.male).toBe(100_000);
    }
  });

  it("a locked split event shows the locked rates", () => {
    const out = toPublicExchangeEvent({
      event: {
        ...event,
        status: "locked",
        feeMode: "split_equal",
        feeAmountMale: null,
        estimatedTotalCost: 600_000,
        minHeads: 5,
      } as never,
      venue: venue as never,
      host,
      regs,
      attendeeAvatars: [],
      now,
    });
    expect(out.fee.kind).toBe("locked");
  });
});

describe("locked split price after a cancel", () => {
  it("keeps the rate the stored fees were charged at (300K, 3 heads + host = 75K)", () => {
    const stored = (id: number, status: string) => ({
      id,
      status,
      maleCount: 1,
      femaleCount: 0,
      waitlistPos: null,
      feeWaived: false,
      feeAmount: 75_000,
    });
    // One of the three charged members cancelled while locked.
    const out = toPublicExchangeEvent({
      event: {
        ...event,
        status: "locked",
        feeMode: "split_equal",
        feeAmountMale: null,
        estimatedTotalCost: 300_000,
        minHeads: 3,
        hostHeads: 1,
      } as never,
      venue: venue as never,
      host,
      regs: [
        stored(1, "approved"),
        stored(2, "approved"),
        stored(3, "cancelled"),
      ],
      attendeeAvatars: [],
      now,
    });
    expect(out.fee).toMatchObject({
      kind: "locked",
      rates: { male: 75_000, female: 75_000 },
    });
  });
});

describe("vnTimeOfDay", () => {
  it("buckets by Vietnam time regardless of the server timezone", () => {
    expect(vnTimeOfDay("2099-06-01T04:59:00.000Z")).toBe("morning"); // 11:59
    expect(vnTimeOfDay("2099-06-01T05:00:00.000Z")).toBe("afternoon"); // 12:00
    expect(vnTimeOfDay("2099-06-01T09:59:00.000Z")).toBe("afternoon"); // 16:59
    expect(vnTimeOfDay("2099-06-01T10:00:00.000Z")).toBe("evening"); // 17:00
    expect(vnTimeOfDay("2099-06-01T12:00:00.000Z")).toBe("evening"); // 19:00
    expect(vnTimeOfDay("2099-06-01T18:00:00.000Z")).toBe("morning"); // 01:00 next day
  });
});

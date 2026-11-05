import { describe, it, expect } from "vitest";
import {
  slotState,
  fits,
  promoteFirstFit,
  nextWaitlistPos,
  type SlotEvent,
  type SlotReg,
} from "./slots";

const NOW = new Date("2026-11-05T00:00:00.000Z");
const before = "2026-11-06T00:00:00.000Z";
const after = "2026-11-04T00:00:00.000Z";

const ev = (over: Partial<SlotEvent> = {}): SlotEvent => ({
  slotsTotal: 6,
  femaleReservedSlots: 0,
  reserveReleaseAt: null,
  ...over,
});
const reg = (over: Partial<SlotReg> & { id: number }): SlotReg => ({
  status: "approved",
  maleCount: 1,
  femaleCount: 0,
  waitlistPos: null,
  ...over,
});

describe("slotState", () => {
  it("pending and approved hold slots, waitlist does not", () => {
    const s = slotState(
      ev(),
      [
        reg({ id: 1, status: "pending", maleCount: 1, femaleCount: 1 }),
        reg({ id: 2, status: "approved" }),
        reg({ id: 3, status: "waitlist", waitlistPos: 1, maleCount: 2 }),
        reg({ id: 4, status: "cancelled" }),
        reg({ id: 5, status: "rejected" }),
      ],
      NOW,
    );
    expect(s.usedTotal).toBe(3);
    expect(s.usedMale).toBe(2);
    expect(s.freeTotal).toBe(3);
  });

  it("male cannot take a female-reserved slot before release", () => {
    const s = slotState(
      ev({ slotsTotal: 4, femaleReservedSlots: 2, reserveReleaseAt: before }),
      [reg({ id: 1 }), reg({ id: 2 })],
      NOW,
    );
    expect(s.maleCap).toBe(2);
    expect(s.freeTotal).toBe(2);
    expect(s.freeForMale).toBe(0);
    expect(s.freeFemaleOnly).toBe(2);
    expect(fits(s, { maleCount: 1, femaleCount: 0 })).toBe(false);
    expect(fits(s, { maleCount: 0, femaleCount: 2 })).toBe(true);
  });

  it("after reserveReleaseAt the reserved slots open to everyone", () => {
    const s = slotState(
      ev({ slotsTotal: 4, femaleReservedSlots: 2, reserveReleaseAt: after }),
      [reg({ id: 1 }), reg({ id: 2 })],
      NOW,
    );
    expect(s.maleCap).toBe(4);
    expect(s.freeForMale).toBe(2);
    expect(s.freeFemaleOnly).toBe(0);
  });

  it("reserveReleaseAt null keeps the reserve forever", () => {
    const s = slotState(
      ev({ slotsTotal: 4, femaleReservedSlots: 2, reserveReleaseAt: null }),
      [],
      new Date("2099-01-01T00:00:00.000Z"),
    );
    expect(s.maleCap).toBe(2);
  });

  it("full only when no slot is free at all", () => {
    const open = slotState(
      ev({ slotsTotal: 3, femaleReservedSlots: 1, reserveReleaseAt: before }),
      [reg({ id: 1 }), reg({ id: 2 })],
      NOW,
    );
    expect(open.freeForMale).toBe(0);
    expect(open.full).toBe(false);
    const full = slotState(
      ev({ slotsTotal: 2 }),
      [reg({ id: 1 }), reg({ id: 2 })],
      NOW,
    );
    expect(full.full).toBe(true);
  });
});

describe("fits", () => {
  it("group of 3 does not fit 2 free slots", () => {
    const s = slotState(
      ev({ slotsTotal: 4 }),
      [reg({ id: 1 }), reg({ id: 2 })],
      NOW,
    );
    expect(fits(s, { maleCount: 2, femaleCount: 1 })).toBe(false);
    expect(fits(s, { maleCount: 1, femaleCount: 1 })).toBe(true);
  });
});

describe("promoteFirstFit", () => {
  it("first-fit promotes the 1-person entry behind a 3-person head", () => {
    const regs = [
      reg({ id: 1 }),
      reg({ id: 2 }),
      reg({ id: 10, status: "waitlist", waitlistPos: 1, maleCount: 3 }),
      reg({ id: 11, status: "waitlist", waitlistPos: 2, maleCount: 1 }),
    ];
    const snapshot = JSON.stringify(regs);
    expect(promoteFirstFit(ev({ slotsTotal: 4 }), regs, NOW)).toEqual([11]);
    expect(JSON.stringify(regs)).toBe(snapshot);
  });

  it("promotion respects the female reserve", () => {
    const regs = [
      reg({ id: 1 }),
      reg({ id: 10, status: "waitlist", waitlistPos: 1, maleCount: 1 }),
      reg({
        id: 11,
        status: "waitlist",
        waitlistPos: 2,
        maleCount: 0,
        femaleCount: 1,
      }),
      reg({
        id: 12,
        status: "waitlist",
        waitlistPos: 3,
        maleCount: 0,
        femaleCount: 1,
      }),
    ];
    const e = ev({
      slotsTotal: 3,
      femaleReservedSlots: 2,
      reserveReleaseAt: before,
    });
    expect(promoteFirstFit(e, regs, NOW)).toEqual([11, 12]);
  });

  it("updates state after each promotion, in waitlistPos order", () => {
    const regs = [
      reg({ id: 20, status: "waitlist", waitlistPos: 5 }),
      reg({ id: 21, status: "waitlist", waitlistPos: 2 }),
      reg({ id: 22, status: "waitlist", waitlistPos: 3 }),
    ];
    expect(promoteFirstFit(ev({ slotsTotal: 2 }), regs, NOW)).toEqual([21, 22]);
  });
});

describe("nextWaitlistPos", () => {
  it("returns max waitlistPos + 1, or 1 when empty", () => {
    expect(nextWaitlistPos([])).toBe(1);
    expect(
      nextWaitlistPos([
        reg({ id: 1 }),
        reg({ id: 2, status: "waitlist", waitlistPos: 4 }),
      ]),
    ).toBe(5);
  });
});

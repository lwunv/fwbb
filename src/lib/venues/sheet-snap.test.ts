import { describe, it, expect } from "vitest";
import {
  SHEET_PEEK_PX,
  SNAP_VELOCITY,
  nextSnapOnTap,
  settleSnap,
  snapOffsets,
} from "./sheet-snap";

const H = 800;
const TOP = 150;

describe("snapOffsets", () => {
  it("offsets are high 150, mid 440, low 728", () => {
    expect(snapOffsets(H, TOP)).toEqual({ high: 150, mid: 440, low: 728 });
    expect(H - snapOffsets(H, TOP).low).toBe(SHEET_PEEK_PX);
  });

  it("mid is clamped between high + 48 and low - 48 on a short container", () => {
    // 55% of 500 = 275 is too close to high: pushed down to high + 48
    expect(snapOffsets(500, 250)).toEqual({ high: 250, mid: 298, low: 428 });
    // 55% of 200 = 110 is too close to low: pulled up to low - 48
    expect(snapOffsets(200, 10)).toEqual({ high: 10, mid: 80, low: 128 });
    // inside both margins: left alone
    expect(snapOffsets(300, 50).mid).toBe(165);
  });

  it("keeps the snaps ordered when the container is too short for both margins", () => {
    const o = snapOffsets(260, 150);
    expect(o.high).toBeLessThanOrEqual(o.mid);
    expect(o.mid).toBeLessThanOrEqual(o.low);
  });

  it("never returns negative offsets before the container is measured", () => {
    const o = snapOffsets(0, 150);
    expect(o.high).toBeGreaterThanOrEqual(0);
    expect(o.mid).toBeGreaterThanOrEqual(0);
    expect(o.low).toBeGreaterThanOrEqual(0);
  });
});

describe("settleSnap", () => {
  const o = snapOffsets(H, TOP);

  it("slow release snaps to the nearest", () => {
    expect(settleSnap(o, 200, 0)).toBe("high");
    expect(settleSnap(o, 400, 100)).toBe("mid");
    expect(settleSnap(o, 600, -200)).toBe("low");
    expect(settleSnap(o, 440, SNAP_VELOCITY)).toBe("mid");
    expect(settleSnap(o, 440, -SNAP_VELOCITY)).toBe("mid");
  });

  it("fast upward flick from mid goes to high, downward goes to low", () => {
    expect(settleSnap(o, 440, -800)).toBe("high");
    expect(settleSnap(o, 440, 800)).toBe("low");
    // released a little below mid but flicked upward: one step up from mid
    expect(settleSnap(o, 470, -900)).toBe("high");
  });

  it("fast flick past an end stays at that end", () => {
    expect(settleSnap(o, 150, -2000)).toBe("high");
    expect(settleSnap(o, 728, 2000)).toBe("low");
  });
});

describe("nextSnapOnTap", () => {
  it("tap cycles low → mid → high → low", () => {
    expect(nextSnapOnTap("low")).toBe("mid");
    expect(nextSnapOnTap("mid")).toBe("high");
    expect(nextSnapOnTap("high")).toBe("low");
  });
});

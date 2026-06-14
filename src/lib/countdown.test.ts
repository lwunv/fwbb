import { describe, it, expect } from "vitest";
import { countdownClock } from "./countdown";

describe("countdownClock", () => {
  it("0ms → 0 ngày, đồng hồ 00:00:00", () => {
    expect(countdownClock(0)).toEqual({ days: 0, clock: "00:00:00" });
  });

  it("dưới 1 phút → giây có pad (90s)", () => {
    expect(countdownClock(90_000)).toEqual({ days: 0, clock: "00:01:30" });
  });

  it("giờ + phút + giây cùng hiển (23h32m15s)", () => {
    const ms = (23 * 3600 + 32 * 60 + 15) * 1000;
    expect(countdownClock(ms)).toEqual({ days: 0, clock: "23:32:15" });
  });

  it("tách ngày, giờ rollover về 0-23 (2 ngày 5 giờ)", () => {
    const ms = (2 * 86400 + 5 * 3600) * 1000;
    expect(countdownClock(ms)).toEqual({ days: 2, clock: "05:00:00" });
  });

  it("clamp về 00:00:00 khi âm (đã quá hạn)", () => {
    expect(countdownClock(-5000)).toEqual({ days: 0, clock: "00:00:00" });
  });

  it("bỏ phần mili-giây lẻ (floor xuống giây)", () => {
    expect(countdownClock(1_999)).toEqual({ days: 0, clock: "00:00:01" });
  });
});

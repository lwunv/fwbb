import { describe, expect, it } from "vitest";
import { hasSeenTour, markTourSeen, TOUR_DONE_KEY } from "./tour-seen";

function memoryStorage(init: Record<string, string> = {}) {
  const data = new Map(Object.entries(init));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe("hasSeenTour", () => {
  it("người mới (chưa có khoá nào) → chưa xem, tour tự chạy", () => {
    expect(hasSeenTour(() => memoryStorage())).toBe(false);
  });

  it("đã xem tour bản cũ → KHÔNG tự hiện lại bản mới", () => {
    expect(hasSeenTour(() => memoryStorage({ "fwbb-tour-done": "1" }))).toBe(
      true,
    );
  });

  it("đã xem bản hiện tại → không tự hiện lại", () => {
    expect(hasSeenTour(() => memoryStorage({ [TOUR_DONE_KEY]: "1" }))).toBe(
      true,
    );
  });

  it("localStorage bị chặn → coi như đã xem (không làm phiền)", () => {
    const blocked = () => {
      throw new Error("SecurityError");
    };
    expect(hasSeenTour(blocked)).toBe(true);
    expect(() => markTourSeen(blocked)).not.toThrow();
  });

  it("xem xong (markTourSeen) → lần sau không tự hiện", () => {
    const s = memoryStorage();
    markTourSeen(() => s);
    expect(hasSeenTour(() => s)).toBe(true);
  });
});

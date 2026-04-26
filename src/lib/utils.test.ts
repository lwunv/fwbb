import { describe, it, expect } from "vitest";
import { roundToThousand, formatVND, formatK } from "./utils";

describe("roundToThousand", () => {
  it("should round up partial thousands", () => {
    expect(roundToThousand(83333)).toBe(84000);
    expect(roundToThousand(1499)).toBe(2000);
  });

  it("should round up at 500 or above", () => {
    expect(roundToThousand(83500)).toBe(84000);
    expect(roundToThousand(83999)).toBe(84000);
    expect(roundToThousand(152500)).toBe(153000);
  });

  it("should not change exact thousands", () => {
    expect(roundToThousand(100000)).toBe(100000);
    expect(roundToThousand(0)).toBe(0);
    expect(roundToThousand(1000)).toBe(1000);
  });

  it("should handle negative values (rounds towards +∞)", () => {
    expect(roundToThousand(-1500)).toBe(-1000);
    expect(roundToThousand(-1499)).toBe(-1000);
    expect(roundToThousand(-1501)).toBe(-1000);
  });
});

describe("formatVND", () => {
  it("should format Vietnamese Dong", () => {
    const result = formatVND(150000);
    // Different locales may produce slightly different formatting
    expect(result).toContain("150.000");
  });

  it("should handle 0", () => {
    const result = formatVND(0);
    expect(result).toContain("0");
  });
});

describe("formatK", () => {
  it("should format to K units rounding up", () => {
    expect(formatK(214000)).toBe("214k");
    expect(formatK(24555)).toBe("25k");
    expect(formatK(1000)).toBe("1k");
  });

  it("should round up partial thousands", () => {
    expect(formatK(1001)).toBe("2k");
    expect(formatK(999)).toBe("1k");
  });

  it("should handle 0", () => {
    expect(formatK(0)).toBe("0k");
  });
});

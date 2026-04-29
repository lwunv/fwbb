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

describe("roundToThousand financial invariants", () => {
  it("never rounds DOWN for positive amounts (admin-protective)", () => {
    for (const v of [1, 999, 1001, 12345, 99999, 999_999, 1_234_567]) {
      const rounded = roundToThousand(v);
      expect(rounded).toBeGreaterThanOrEqual(v);
      expect(rounded % 1000).toBe(0);
    }
  });

  it("output is always an integer multiple of 1000", () => {
    for (const v of [0, 1, 250000, 333333, 1_500_001]) {
      const r = roundToThousand(v);
      expect(Number.isInteger(r)).toBe(true);
      expect(r % 1000).toBe(0);
    }
  });

  it("idempotent: roundToThousand(roundToThousand(x)) === roundToThousand(x)", () => {
    for (const v of [123, 1000, 1234, 99_999, 123_456]) {
      expect(roundToThousand(roundToThousand(v))).toBe(roundToThousand(v));
    }
  });

  it("matches expected discrete values", () => {
    const cases: Array<[number, number]> = [
      [0, 0],
      [1, 1000],
      [999, 1000],
      [1000, 1000],
      [1001, 2000],
      [83_333, 84_000],
      [83_500, 84_000],
      [152_500, 153_000],
      [200_000, 200_000],
      [200_001, 201_000],
    ];
    for (const [input, expected] of cases) {
      expect(roundToThousand(input)).toBe(expected);
    }
  });
});

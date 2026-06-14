import { describe, expect, it } from "vitest";
import {
  QUA_PER_TUBE,
  LOW_STOCK_THRESHOLD_QUA,
  tubesToQua,
  isLowStock,
  splitOngQua,
  computeCurrentStock,
} from "./inventory-core";

describe("constants", () => {
  it("QUA_PER_TUBE is 12", () => {
    expect(QUA_PER_TUBE).toBe(12);
  });
  it("LOW_STOCK_THRESHOLD_QUA is 12", () => {
    expect(LOW_STOCK_THRESHOLD_QUA).toBe(12);
  });
});

describe("tubesToQua", () => {
  it("converts tubes to quả (× 12)", () => {
    expect(tubesToQua(0)).toBe(0);
    expect(tubesToQua(1)).toBe(12);
    expect(tubesToQua(5)).toBe(60);
    expect(tubesToQua(100)).toBe(1200);
  });
});

describe("isLowStock", () => {
  it("is true below the 12-quả threshold", () => {
    expect(isLowStock(11)).toBe(true);
    expect(isLowStock(0)).toBe(true);
  });
  it("is false at or above the 12-quả threshold", () => {
    expect(isLowStock(12)).toBe(false);
    expect(isLowStock(13)).toBe(false);
    expect(isLowStock(120)).toBe(false);
  });
  it("treats negative (raw) stock as low", () => {
    expect(isLowStock(-5)).toBe(true);
  });
});

describe("splitOngQua", () => {
  it("splits into whole tubes + leftover quả", () => {
    expect(splitOngQua(25)).toEqual({ ong: 2, qua: 1 });
    expect(splitOngQua(0)).toEqual({ ong: 0, qua: 0 });
    expect(splitOngQua(12)).toEqual({ ong: 1, qua: 0 });
    expect(splitOngQua(11)).toEqual({ ong: 0, qua: 11 });
    expect(splitOngQua(144)).toEqual({ ong: 12, qua: 0 });
  });
});

describe("computeCurrentStock", () => {
  it("computes raw = purchased − used + adjust", () => {
    expect(
      computeCurrentStock({ purchasedQua: 120, usedQua: 40, adjustQua: 0 }),
    ).toEqual({ rawStockQua: 80, currentStockQua: 80 });
  });
  it("applies positive and negative adjustment", () => {
    expect(
      computeCurrentStock({ purchasedQua: 120, usedQua: 40, adjustQua: 5 }),
    ).toEqual({ rawStockQua: 85, currentStockQua: 85 });
    expect(
      computeCurrentStock({ purchasedQua: 120, usedQua: 40, adjustQua: -5 }),
    ).toEqual({ rawStockQua: 75, currentStockQua: 75 });
  });
  it("clamps negative raw stock to 0 but preserves the raw value", () => {
    expect(
      computeCurrentStock({ purchasedQua: 12, usedQua: 30, adjustQua: 0 }),
    ).toEqual({ rawStockQua: -18, currentStockQua: 0 });
  });
});

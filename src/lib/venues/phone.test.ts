import { describe, it, expect } from "vitest";
import { toTelNumber } from "./phone";

describe("toTelNumber", () => {
  it("keeps digits and plus, dropping spaces, dots and dashes", () => {
    expect(toTelNumber("0912 345-678")).toBe("0912345678");
    expect(toTelNumber("+84 912.345.678")).toBe("+84912345678");
  });

  it("returns null when there is no digit to dial", () => {
    for (const raw of [null, undefined, "", "   ", "+", " + ", "không có"]) {
      expect(toTelNumber(raw)).toBeNull();
    }
  });
});

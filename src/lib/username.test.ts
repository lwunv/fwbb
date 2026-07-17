import { describe, it, expect } from "vitest";
import { normalizeUsername } from "./username";

describe("normalizeUsername", () => {
  it("chuẩn hoá lowercase + trim", () => {
    expect(normalizeUsername("  CunCon ")).toEqual({ value: "cuncon" });
  });
  it("rỗng → value null (xoá)", () => {
    expect(normalizeUsername("   ")).toEqual({ value: null });
  });
  it("ký tự lạ → invalid", () => {
    expect(normalizeUsername("a b!")).toEqual({ code: "invalid" });
  });
  it("quá ngắn (<3) → invalid", () => {
    expect(normalizeUsername("ab")).toEqual({ code: "invalid" });
  });
  it("hợp lệ a-z0-9._ 3-32", () => {
    expect(normalizeUsername("nam.viet_99")).toEqual({ value: "nam.viet_99" });
  });
});

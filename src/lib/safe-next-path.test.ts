import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-next-path";

describe("safeNextPath", () => {
  it("giữ đường dẫn nội bộ, kèm query và hash", () => {
    expect(safeNextPath("/giao-luu/abc?x=1")).toBe("/giao-luu/abc?x=1");
    expect(safeNextPath("/giao-luu?a=1#top")).toBe("/giao-luu?a=1#top");
  });

  it.each([
    ["//evil.com"],
    ["/\\evil.com"],
    ["/\t/evil.com"],
    ["/\n/evil.com"],
    ["/\u007f/evil.com"],
    ["https://evil.com"],
    ["javascript:alert(1)"],
    [""],
    [null],
    [undefined],
    [123],
    [{}],
  ])("%j -> /giao-luu", (raw) => {
    expect(safeNextPath(raw)).toBe("/giao-luu");
  });

  it("giữ nguyên dạng đã encode vì vẫn cùng origin", () => {
    expect(safeNextPath("/%09/evil.com")).toBe("/%09/evil.com");
  });
});

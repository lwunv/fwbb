import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-next-path";

describe("safeNextPath", () => {
  it("giữ đường dẫn nội bộ, kèm query và hash", () => {
    expect(safeNextPath("/exchanges/abc?x=1")).toBe("/exchanges/abc?x=1");
    expect(safeNextPath("/exchanges?a=1#top")).toBe("/exchanges?a=1#top");
  });

  it.each([
    ["//evil.com"],
    ["/\\evil.com"],
    ["/\t/evil.com"],
    ["/\n/evil.com"],
    ["/\u007f/evil.com"],
    ["/..//evil.com"],
    ["/.//evil.com"],
    ["/%2e%2e//evil.com"],
    ["/a/..//evil.com"],
    ["https://evil.com"],
    ["javascript:alert(1)"],
    [""],
    [null],
    [undefined],
    [123],
    [{}],
  ])("%j -> /exchanges", (raw) => {
    expect(safeNextPath(raw)).toBe("/exchanges");
  });

  it("giữ nguyên dạng đã encode vì vẫn cùng origin", () => {
    expect(safeNextPath("/%09/evil.com")).toBe("/%09/evil.com");
  });
});

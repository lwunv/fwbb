import { describe, it, expect, afterEach, vi } from "vitest";
import { isInFacebookBrowser, isInZaloBrowser } from "./facebook-sdk";

function withUserAgent(ua: string) {
  vi.stubGlobal("navigator", { userAgent: ua });
}

afterEach(() => vi.unstubAllGlobals());

describe("isInZaloBrowser", () => {
  it("nhận ra trình duyệt trong app Zalo (không phân biệt hoa thường)", () => {
    withUserAgent(
      "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 Zalo/12.3",
    );
    expect(isInZaloBrowser()).toBe(true);
    withUserAgent("Mozilla/5.0 (iPhone) AppleWebKit/605 zalo/23.01");
    expect(isInZaloBrowser()).toBe(true);
  });

  it("trình duyệt thường và Facebook không phải Zalo", () => {
    withUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36");
    expect(isInZaloBrowser()).toBe(false);
    withUserAgent("Mozilla/5.0 (iPhone) [FBAN/FBIOS;FBAV/400.0]");
    expect(isInZaloBrowser()).toBe(false);
  });

  it("không có navigator (server) hoặc UA rỗng → false", () => {
    vi.stubGlobal("navigator", undefined);
    expect(isInZaloBrowser()).toBe(false);
    withUserAgent("");
    expect(isInZaloBrowser()).toBe(false);
  });

  it("isInFacebookBrowser giữ nguyên hành vi", () => {
    withUserAgent("x FBAV/1 y");
    expect(isInFacebookBrowser()).toBe(true);
    withUserAgent("Zalo/12");
    expect(isInFacebookBrowser()).toBe(false);
  });
});

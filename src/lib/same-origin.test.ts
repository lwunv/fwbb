import { describe, it, expect } from "vitest";
import { isSameOriginRequest } from "./same-origin";

const APP = "http://localhost:3101";

function req(headers: Record<string, string>): Request {
  return new Request(`${APP}/api/auth/zalo/start`, {
    method: "POST",
    headers,
  });
}

describe("isSameOriginRequest", () => {
  it("Origin lạ → false", () => {
    expect(isSameOriginRequest(req({ origin: "https://evil.com" }), APP)).toBe(
      false,
    );
  });

  it('Origin "null" (iframe sandbox, file://) → false', () => {
    expect(isSameOriginRequest(req({ origin: "null" }), APP)).toBe(false);
  });

  it("Origin cùng host nhưng khác cổng hoặc giao thức → false", () => {
    expect(
      isSameOriginRequest(req({ origin: "http://localhost:3000" }), APP),
    ).toBe(false);
    expect(
      isSameOriginRequest(req({ origin: "https://localhost:3101" }), APP),
    ).toBe(false);
  });

  it("Origin đúng thì Sec-Fetch-Site không còn quyết định → true", () => {
    expect(isSameOriginRequest(req({ origin: APP }), APP)).toBe(true);
  });

  it("không Origin + Sec-Fetch-Site cross-site → false", () => {
    expect(
      isSameOriginRequest(req({ "sec-fetch-site": "cross-site" }), APP),
    ).toBe(false);
    expect(
      isSameOriginRequest(req({ "sec-fetch-site": "same-site" }), APP),
    ).toBe(false);
  });

  it("không Origin + Sec-Fetch-Site same-origin → true", () => {
    expect(
      isSameOriginRequest(req({ "sec-fetch-site": "same-origin" }), APP),
    ).toBe(true);
  });

  it("không có header nào → true (Turnstile chặn phía sau)", () => {
    expect(isSameOriginRequest(req({}), APP)).toBe(true);
  });
});

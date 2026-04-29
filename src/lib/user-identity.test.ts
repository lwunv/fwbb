/**
 * Unit tests cho user-identity (member cookie HMAC).
 *
 * Audit High #7: cookie cũ chỉ ký `memberId:facebookId` — không có `iat`/`exp`,
 * không expire ở phía server. Nếu bị hijack thì sống tới khi browser xóa.
 *
 * Sau fix:
 *  - Cookie value = `memberId:facebookId:issuedAtMs:signature`.
 *  - parseUserCookie reject nếu cookie quá cũ (> MAX_AGE_MS).
 *  - parseUserCookie reject nếu chữ ký sai (constant-time HMAC compare).
 *  - parseUserCookie cũng reject các format cũ thiếu issuedAt — buộc user
 *    đăng nhập lại (mục đích: rotate cookies sau triển khai fix).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// USER_COOKIE_SECRET phải tồn tại trước khi import module-under-test (top-level
// throw guard).
process.env.USER_COOKIE_SECRET =
  process.env.USER_COOKIE_SECRET ?? "test-secret-at-least-16-chars-long";

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

const { createUserCookieValue, parseUserCookie } =
  await import("./user-identity");

describe("createUserCookieValue + parseUserCookie", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("round-trip: value created now parses back to original", () => {
    const value = createUserCookieValue(42, "fb-42");
    const parsed = parseUserCookie(value);
    expect(parsed).toEqual({ memberId: 42, facebookId: "fb-42" });
  });

  it("rejects tampered signature", () => {
    const value = createUserCookieValue(42, "fb-42");
    const parts = value.split(":");
    parts[parts.length - 1] = "0".repeat(64); // bogus signature
    const parsed = parseUserCookie(parts.join(":"));
    expect(parsed).toBeNull();
  });

  it("rejects tampered memberId (signature won't match)", () => {
    const value = createUserCookieValue(42, "fb-42");
    const parts = value.split(":");
    parts[0] = "999"; // try to escalate to a different member
    const parsed = parseUserCookie(parts.join(":"));
    expect(parsed).toBeNull();
  });

  it("rejects legacy cookies missing issuedAt (3 parts, no iat)", () => {
    // Old format: memberId:facebookId:signature — no issuedAt timestamp.
    // After fix, this must NOT parse, forcing a re-login.
    const parsed = parseUserCookie("42:fb-42:abc");
    expect(parsed).toBeNull();
  });

  it("rejects expired cookies (issuedAt > MAX_AGE_MS ago)", () => {
    // Set system time to "now", create cookie, then jump forward 91 days.
    vi.useFakeTimers();
    const baseNow = new Date("2026-01-01T00:00:00Z").getTime();
    vi.setSystemTime(baseNow);
    const value = createUserCookieValue(7, "fb-7");
    // 91 days later
    vi.setSystemTime(baseNow + 91 * 24 * 60 * 60 * 1000);
    const parsed = parseUserCookie(value);
    expect(parsed).toBeNull();
  });

  it("accepts cookies inside MAX_AGE_MS window", () => {
    vi.useFakeTimers();
    const baseNow = new Date("2026-01-01T00:00:00Z").getTime();
    vi.setSystemTime(baseNow);
    const value = createUserCookieValue(7, "fb-7");
    // 29 days later — well inside the 30-day window
    vi.setSystemTime(baseNow + 29 * 24 * 60 * 60 * 1000);
    const parsed = parseUserCookie(value);
    expect(parsed).toEqual({ memberId: 7, facebookId: "fb-7" });
  });

  it("rejects malformed iat (non-numeric)", () => {
    // Construct manually a value with non-numeric iat
    const tampered = "1:fb-1:NOTANUMBER:" + "x".repeat(64);
    const parsed = parseUserCookie(tampered);
    expect(parsed).toBeNull();
  });
});

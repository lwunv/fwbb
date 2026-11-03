import { describe, expect, it } from "vitest";
import { createUserCookieValue } from "./user-identity";
import {
  ZALO_STATE_COOKIE,
  ZALO_STATE_COOKIE_OPTS,
  openZaloState,
  sealZaloState,
  statesMatch,
  type ZaloOAuthState,
} from "./zalo-oauth-state";

const NOW = 1_800_000_000_000;
const sample: ZaloOAuthState = {
  state: "st4te",
  verifier: "v".repeat(43),
  intent: "exchange",
  next: "/giao-luu/abc?x=1",
  iat: NOW,
};

describe("zalo oauth state cookie", () => {
  it("seal rồi open ra đúng object", () => {
    expect(openZaloState(sealZaloState(sample), NOW + 1000)).toEqual(sample);
  });

  it("sửa 1 ký tự bất kỳ -> null", () => {
    const raw = sealZaloState(sample);
    for (const i of [0, Math.floor(raw.length / 2), raw.length - 1]) {
      const c = raw[i] === "a" ? "b" : "a";
      expect(openZaloState(raw.slice(0, i) + c + raw.slice(i + 1), NOW)).toBe(
        null,
      );
    }
  });

  it("quá 600 giây -> null, đúng 600 giây còn mở được", () => {
    const raw = sealZaloState(sample);
    expect(openZaloState(raw, NOW + 600_000)).toEqual(sample);
    expect(openZaloState(raw, NOW + 600_001)).toBeNull();
  });

  it("iat ở tương lai xa -> null", () => {
    const raw = sealZaloState({ ...sample, iat: NOW + 3_600_000 });
    expect(openZaloState(raw, NOW)).toBeNull();
  });

  it("raw rỗng, undefined, rác -> null", () => {
    for (const r of [
      undefined,
      "",
      "abc",
      "a.b",
      "a.b.c",
      ".",
      "x".repeat(5000),
    ])
      expect(openZaloState(r, NOW)).toBeNull();
  });

  it("chữ ký cookie fwbb-user không mở được ở đây", () => {
    expect(openZaloState(createUserCookieValue(1, "zalo:1"), NOW)).toBeNull();
  });

  it("payload ký đúng nhưng sai shape -> null", () => {
    const raw = sealZaloState({ ...sample, intent: "other" } as never);
    expect(openZaloState(raw, NOW)).toBeNull();
  });

  it("statesMatch", () => {
    expect(statesMatch("abc", "abc")).toBe(true);
    expect(statesMatch("abc", "abd")).toBe(false);
    expect(statesMatch("abc", "abcd")).toBe(false);
    expect(statesMatch("", "")).toBe(true);
  });

  it("hằng số cookie", () => {
    expect(ZALO_STATE_COOKIE).toBe("fwbb-zalo-oauth");
    expect(ZALO_STATE_COOKIE_OPTS).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/api/auth/zalo",
    });
    expect(typeof ZALO_STATE_COOKIE_OPTS.secure).toBe("boolean");
  });
});

import { describe, it, expect, afterEach, vi } from "vitest";
import { sealVerifyToken, openVerifyToken, newUnsubToken } from "./tokens";

const DAY = 24 * 60 * 60 * 1000;

describe("verify token", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("verify token round-trips; tampered token returns null; expires after 7 days; base64-decoding it reveals no email", () => {
    const email = "Someone.Private@example.com";
    const now = new Date("2026-11-04T00:00:00Z");
    const token = sealVerifyToken(7, email, now);

    const opened = openVerifyToken(token, now);
    expect(opened?.mid).toBe(7);
    // Cùng email khác hoa thường thì cùng băm.
    const again = openVerifyToken(
      sealVerifyToken(7, "someone.private@EXAMPLE.com", now),
      now,
    );
    expect(again?.eh).toBe(opened?.eh);

    const [payload, sig] = token.split(".");
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    expect(decoded.toLowerCase()).not.toContain("someone");
    expect(decoded).not.toContain("@");

    // Sửa payload (đổi mid) hoặc chữ ký thì null.
    const forged = Buffer.from(
      decoded.replace('"mid":7', '"mid":8'),
      "utf8",
    ).toString("base64url");
    expect(openVerifyToken(`${forged}.${sig}`, now)).toBeNull();
    const badSig = (sig[0] === "0" ? "1" : "0") + sig.slice(1);
    expect(openVerifyToken(`${payload}.${badSig}`, now)).toBeNull();
    expect(openVerifyToken("garbage", now)).toBeNull();
    expect(openVerifyToken("", now)).toBeNull();

    expect(
      openVerifyToken(token, new Date(now.getTime() + 7 * DAY - 1000)),
    ).not.toBeNull();
    expect(
      openVerifyToken(token, new Date(now.getTime() + 7 * DAY + 1000)),
    ).toBeNull();
  });

  it("returns null when the secret is missing instead of using a fallback", () => {
    const token = sealVerifyToken(1, "a@b.co");
    vi.stubEnv("USER_COOKIE_SECRET", "");
    expect(openVerifyToken(token)).toBeNull();
    expect(() => sealVerifyToken(1, "a@b.co")).toThrow();
  });

  it("unsub tokens are random 32-byte base64url strings", () => {
    const a = newUnsubToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newUnsubToken()).not.toBe(a);
  });
});

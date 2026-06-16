import { describe, it, expect } from "vitest";
import {
  generateResetToken,
  hashResetToken,
  resetTokenExpiryIso,
  isResetTokenExpired,
} from "./password-reset-token";

describe("password-reset-token", () => {
  it("generateResetToken returns a url-safe raw token and its sha256 hash", () => {
    const { rawToken, tokenHash } = generateResetToken();
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, path-safe
    expect(rawToken.length).toBeGreaterThanOrEqual(40);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
    expect(hashResetToken(rawToken)).toBe(tokenHash); // hash is deterministic
  });

  it("two tokens differ", () => {
    expect(generateResetToken().rawToken).not.toBe(
      generateResetToken().rawToken,
    );
  });

  it("expiry is ISO-UTC ~60 min ahead and lexically comparable", () => {
    const iso = resetTokenExpiryIso();
    expect(iso).toMatch(/Z$/);
    const ms = new Date(iso).getTime() - Date.now();
    expect(ms).toBeGreaterThan(59 * 60_000);
    expect(ms).toBeLessThanOrEqual(60 * 60_000 + 1000);
  });

  it("isResetTokenExpired: past = true, future = false", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isResetTokenExpired(past)).toBe(true);
    expect(isResetTokenExpired(future)).toBe(false);
  });
});

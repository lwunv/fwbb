import { describe, it, expect } from "vitest";
import {
  RESET_TOKEN_TTL_MS,
  INVITE_TOKEN_TTL_MS,
  hashResetToken,
  generateResetToken,
  resetTokenExpiryIso,
  inviteTokenExpiryIso,
  isResetTokenExpired,
} from "./password-reset-token";

describe("generateResetToken / hashResetToken", () => {
  it("rawToken hashes to the returned tokenHash", () => {
    const { rawToken, tokenHash } = generateResetToken();
    expect(hashResetToken(rawToken)).toBe(tokenHash);
  });

  it("generates a distinct rawToken/tokenHash pair each call", () => {
    const a = generateResetToken();
    const b = generateResetToken();
    expect(a.rawToken).not.toBe(b.rawToken);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });
});

describe("isResetTokenExpired", () => {
  it("false for a future ISO string", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isResetTokenExpired(future)).toBe(false);
  });

  it("true for a past ISO string", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isResetTokenExpired(past)).toBe(true);
  });
});

describe("resetTokenExpiryIso / inviteTokenExpiryIso", () => {
  it("resetTokenExpiryIso is ~RESET_TOKEN_TTL_MS from now", () => {
    const before = Date.now();
    const iso = resetTokenExpiryIso();
    const delta = new Date(iso).getTime() - before;
    expect(delta).toBeGreaterThan(RESET_TOKEN_TTL_MS - 1000);
    expect(delta).toBeLessThanOrEqual(RESET_TOKEN_TTL_MS + 1000);
  });

  it("inviteTokenExpiryIso is later than resetTokenExpiryIso", () => {
    const reset = resetTokenExpiryIso();
    const invite = inviteTokenExpiryIso();
    expect(new Date(invite).getTime()).toBeGreaterThan(
      new Date(reset).getTime(),
    );
  });

  it("INVITE_TOKEN_TTL_MS is 7 days", () => {
    expect(INVITE_TOKEN_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

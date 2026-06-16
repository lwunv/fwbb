import { randomBytes, createHash } from "crypto";

/** Token lifetime: 60 minutes (per design decision). */
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

/** sha256 hex of the raw token. Deterministic — used for storage + lookup. */
export function hashResetToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/** 256-bit url-safe (base64url) raw token + its stored hash. */
export function generateResetToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(32).toString("base64url");
  return { rawToken, tokenHash: hashResetToken(rawToken) };
}

/** Expiry as ISO-8601 UTC string (lexically comparable to other toISOString()). */
export function resetTokenExpiryIso(): string {
  return new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
}

/** True if the stored ISO expiry is in the past. */
export function isResetTokenExpired(expiresAtIso: string): boolean {
  return new Date(expiresAtIso).getTime() <= Date.now();
}

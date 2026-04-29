import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";

const USER_COOKIE = "fwbb-user";
const SECRET_RAW = process.env.USER_COOKIE_SECRET;
if (!SECRET_RAW || SECRET_RAW.length < 16) {
  throw new Error(
    "USER_COOKIE_SECRET env var is required and must be at least 16 characters. Refusing to start with a weak/missing cookie HMAC secret.",
  );
}
const SECRET: string = SECRET_RAW;

/**
 * Server-side max age for the cookie. The browser-side maxAge is also set,
 * but a stolen cookie can still be replayed before that expires. The
 * issuedAt timestamp baked into the signed payload lets us reject stale
 * cookies even if the browser kept them around.
 */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
/** Browser cookie maxAge — slightly longer so a fresh login replaces it
 * before the server expiry kicks in. */
const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 60; // 60 days (browser hint)

function sign(data: string): string {
  return createHmac("sha256", SECRET).update(data).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export function createUserCookieValue(
  memberId: number,
  facebookId: string,
): string {
  const issuedAt = Date.now();
  const data = `${memberId}:${facebookId}:${issuedAt}`;
  const signature = sign(data);
  return `${data}:${signature}`;
}

/**
 * Parse and validate the cookie value. Returns null for any of:
 *  - Wrong shape (must be exactly 4 colon-separated parts).
 *  - Non-numeric memberId or issuedAt.
 *  - Bad signature (constant-time HMAC compare).
 *  - issuedAt > MAX_AGE_MS in the past (expired) or in the future (clock-skew).
 *
 * Legacy 3-part cookies (no issuedAt) are rejected — users must re-login
 * after the rotate-everything migration.
 */
export function parseUserCookie(
  value: string,
): { memberId: number; facebookId: string } | null {
  const parts = value.split(":");
  if (parts.length !== 4) return null;
  const [memberIdStr, facebookId, issuedAtStr, signature] = parts;
  const memberId = parseInt(memberIdStr, 10);
  const issuedAt = parseInt(issuedAtStr, 10);
  if (!Number.isFinite(memberId) || !Number.isFinite(issuedAt)) return null;

  const data = `${memberIdStr}:${facebookId}:${issuedAtStr}`;
  const expected = sign(data);
  if (!safeEqualHex(expected, signature)) return null;

  const now = Date.now();
  if (issuedAt > now + 60_000) return null; // future-dated → reject
  if (now - issuedAt > MAX_AGE_MS) return null; // expired

  return { memberId, facebookId };
}

export async function setUserCookie(memberId: number, facebookId: string) {
  const cookieStore = await cookies();
  cookieStore.set(USER_COOKIE, createUserCookieValue(memberId, facebookId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE_SEC,
    path: "/",
  });
}

export async function getUserFromCookie(): Promise<{
  memberId: number;
  facebookId: string;
} | null> {
  const cookieStore = await cookies();
  const value = cookieStore.get(USER_COOKIE)?.value;
  if (!value) return null;
  return parseUserCookie(value);
}

export async function clearUserCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(USER_COOKIE);
}

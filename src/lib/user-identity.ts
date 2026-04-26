import { cookies } from "next/headers";
import { createHmac } from "crypto";

const USER_COOKIE = "fwbb-user";
const SECRET_RAW = process.env.USER_COOKIE_SECRET;
if (!SECRET_RAW || SECRET_RAW.length < 16) {
  throw new Error(
    "USER_COOKIE_SECRET env var is required and must be at least 16 characters. Refusing to start with a weak/missing cookie HMAC secret.",
  );
}
const SECRET: string = SECRET_RAW;

function sign(data: string): string {
  return createHmac("sha256", SECRET).update(data).digest("hex");
}

export function createUserCookieValue(
  memberId: number,
  facebookId: string,
): string {
  const data = `${memberId}:${facebookId}`;
  const signature = sign(data);
  return `${data}:${signature}`;
}

export function parseUserCookie(
  value: string,
): { memberId: number; facebookId: string } | null {
  const parts = value.split(":");
  if (parts.length !== 3) return null;
  const [memberIdStr, facebookId, signature] = parts;
  const data = `${memberIdStr}:${facebookId}`;
  if (sign(data) !== signature) return null;
  return { memberId: parseInt(memberIdStr, 10), facebookId };
}

export async function setUserCookie(memberId: number, facebookId: string) {
  const cookieStore = await cookies();
  cookieStore.set(USER_COOKIE, createUserCookieValue(memberId, facebookId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
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

import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { COMMENT_PASS_TTL_MS } from "./constants";

export const COMMENT_PASS_COOKIE = "fwbb_xcp";

const MAX_FUTURE_SKEW_MS = 60_000;
const MAX_RAW_LENGTH = 128;
// Tiền tố miền: chữ ký các cookie khác dùng cùng khoá không dùng lại được ở đây.
const DOMAIN = "exchange-comment-pass:";

/** Thiếu khoá thì ném; người gọi tự đổi thành false / ok:false, không có khoá dự phòng. */
function secret(): string {
  const s = process.env.USER_COOKIE_SECRET;
  if (!s || s.length < 16) {
    throw new Error("USER_COOKIE_SECRET is required (min 16 chars)");
  }
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret())
    .update(DOMAIN + payload)
    .digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/** `memberId.issuedAtMs.hmacHex`: nhớ rằng member này đã qua Turnstile gần đây. */
export function sealCommentPass(memberId: number, now: Date): string {
  const payload = `${memberId}.${now.getTime()}`;
  return `${payload}.${sign(payload)}`;
}

/** Mọi dạng sai (kể cả thiếu khoá) đều false, không ném. */
export function openCommentPass(
  raw: string | undefined,
  memberId: number,
  now: Date,
): boolean {
  if (!raw || raw.length > MAX_RAW_LENGTH) return false;
  const parts = raw.split(".");
  if (parts.length !== 3) return false;
  const [mid, iat, sig] = parts;
  if (!/^\d+$/.test(mid) || !/^\d+$/.test(iat) || !sig) return false;
  if (Number(mid) !== memberId) return false;
  const issuedAt = Number(iat);
  const t = now.getTime();
  if (issuedAt > t + MAX_FUTURE_SKEW_MS) return false;
  if (t - issuedAt > COMMENT_PASS_TTL_MS) return false;
  try {
    return safeEqualHex(sig, sign(`${mid}.${iat}`));
  } catch {
    return false;
  }
}

export async function hasCommentPass(memberId: number): Promise<boolean> {
  const store = await cookies();
  return openCommentPass(
    store.get(COMMENT_PASS_COOKIE)?.value,
    memberId,
    new Date(),
  );
}

export async function grantCommentPass(
  memberId: number,
): Promise<{ ok: true } | { ok: false }> {
  let value: string;
  try {
    value = sealCommentPass(memberId, new Date());
  } catch {
    console.error("[Exchange] comment-pass-config", { id: memberId });
    return { ok: false };
  }
  const store = await cookies();
  store.set(COMMENT_PASS_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COMMENT_PASS_TTL_MS / 1000,
  });
  return { ok: true };
}

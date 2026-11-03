import { headers } from "next/headers";
import { createHmac } from "crypto";
import { ipRateLimitKey } from "./ip-rate-limit-key";

export { ipRateLimitKey };

/**
 * Trusted client IP for rate-limit keys.
 *
 * SECURITY: the LEFTMOST `x-forwarded-for` hop is CLIENT-controlled. On Vercel
 * the platform appends the real client IP to any inbound XFF, so reading
 * `xff.split(",")[0]` returns whatever the attacker sent → every per-IP rate
 * limit resets per request (total bypass → unbounded brute-force).
 *
 * Correct order on Vercel: trust `x-real-ip` (set by the platform proxy, not
 * passed through from the client); if absent, use the RIGHTMOST XFF hop (the IP
 * the trusted proxy actually observed), never the leftmost. Falls back to
 * "unknown" only in local/dev where no proxy header exists.
 */
export async function getTrustedClientIp(): Promise<string> {
  const h = await headers();
  const real = h.get("x-real-ip")?.trim();
  if (real) return real;
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const hops = xff
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return "unknown";
}

/**
 * Khoá rate limit đã băm, để DB không lưu IP thô (dữ liệu cá nhân). HMAC với
 * USER_COOKIE_SECRET nên không tra ngược được bằng bảng IPv4 dựng sẵn; tiền tố
 * "rl-ip:v1:" tách miền khỏi các chữ ký khác dùng cùng khoá.
 */
export function hashedIpKey(ip: string): string {
  const secret = process.env.USER_COOKIE_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "USER_COOKIE_SECRET env var is required and must be at least 16 characters.",
    );
  }
  return createHmac("sha256", secret)
    .update(`rl-ip:v1:${ipRateLimitKey(ip)}`)
    .digest("hex")
    .slice(0, 32);
}

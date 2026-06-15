import { headers } from "next/headers";

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

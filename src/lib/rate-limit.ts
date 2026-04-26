/**
 * In-memory rate limiter (per-process). Good enough for single-instance
 * deployments to slow down brute-force / spam. Swap for Upstash or Redis if
 * you scale horizontally.
 *
 * Each key gets a fixed-size sliding window counter. Calls beyond `limit` in
 * the window are rejected with the seconds-until-reset.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Periodically prune expired buckets so the Map doesn't grow unbounded.
let lastPrune = 0;
function maybePrune(now: number) {
  if (now - lastPrune < 60_000) return;
  lastPrune = now;
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k);
  }
}

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the bucket resets (only set when ok=false). */
  retryAfter?: number;
  remaining: number;
}

/**
 * Increment the counter for `key` and return whether the call is allowed.
 *
 * @example
 * const r = checkRateLimit(`login:${ip}`, 5, 60_000); // 5 / minute
 * if (!r.ok) return { error: `Too many requests, retry in ${r.retryAfter}s` };
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  maybePrune(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1 };
  }

  if (existing.count >= limit) {
    return {
      ok: false,
      retryAfter: Math.ceil((existing.resetAt - now) / 1000),
      remaining: 0,
    };
  }

  existing.count += 1;
  return { ok: true, remaining: limit - existing.count };
}

/** Test helper: reset all buckets. */
export function _resetRateLimitsForTesting() {
  buckets.clear();
  lastPrune = 0;
}

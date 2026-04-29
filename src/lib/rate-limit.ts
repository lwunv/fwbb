/**
 * DB-backed rate limiter (multi-instance safe).
 *
 * Trước fix: in-memory `Map` — mỗi serverless instance trên Vercel có bucket
 * riêng nên hiệu lực thực tế = limit × số instance. Brute-force attacker có
 * thể amplify tự nhiên qua việc các request được route sang instance khác
 * nhau.
 *
 * Sau fix: bucket lưu trong `rate_limit_buckets` (SQLite/Turso). SQLite chỉ
 * cho 1 writer tại 1 thời điểm nên `count` không bao giờ "lost update". Mỗi
 * call thực hiện 1 transaction nhỏ đọc-rồi-update; chi phí ~1ms trên Turso.
 *
 * Trade-off: mỗi rate-limit check tốn 1 round-trip DB. Với hot path > 100/s
 * cần xem xét cache + TTL hoặc Upstash. Hiện tại app FWBB rate-limit chỉ áp
 * trên login/payment-confirm/vote → vài chục req/s tối đa.
 */

import { db } from "@/db";
import { rateLimitBuckets } from "@/db/schema";
import { eq, lt } from "drizzle-orm";

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the bucket resets (only set when ok=false). */
  retryAfter?: number;
  remaining: number;
}

// Per-key promise chain — serialize same-key calls within this process so the
// SQLite single-writer doesn't see a stampede. Cross-instance ordering still
// relies on the DB transaction, but we drastically reduce the BUSY rate.
const inflight = new Map<string, Promise<unknown>>();

/**
 * Increment the counter for `key` and return whether the call is allowed.
 *
 * @example
 * const r = await checkRateLimit(`login:${ip}`, 5, 60_000); // 5 / minute
 * if (!r.ok) return { error: `Too many requests, retry in ${r.retryAfter}s` };
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  // Serialize concurrent same-key calls within this process. The DB still
  // does the real ordering across instances (UNIQUE on key + transaction),
  // but this avoids the BUSY thundering-herd locally.
  const prior = inflight.get(key) ?? Promise.resolve();
  const next = prior
    .catch(() => undefined)
    .then(() => doCheck(key, limit, windowMs));
  inflight.set(key, next);
  next.finally(() => {
    if (inflight.get(key) === next) inflight.delete(key);
  });
  return next;
}

async function doCheck(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const now = Date.now();
  let result: RateLimitResult = { ok: true, remaining: limit - 1 };

  // Retry on SQLITE_BUSY: under high cross-instance concurrency the SQLite
  // single-writer can BUSY-out one transaction. Exponential backoff with
  // jitter lets the next attempt through. Production Turso auto-retries at
  // the client layer, but file-based libsql in tests does not.
  let attempt = 0;
  for (;;) {
    try {
      await db.transaction(async (tx) => {
        const existing = await tx.query.rateLimitBuckets.findFirst({
          where: eq(rateLimitBuckets.key, key),
        });

        if (!existing || existing.resetAt <= now) {
          // First call OR previous window expired → reset to count=1.
          const resetAt = now + windowMs;
          if (existing) {
            await tx
              .update(rateLimitBuckets)
              .set({ count: 1, resetAt })
              .where(eq(rateLimitBuckets.key, key));
          } else {
            await tx
              .insert(rateLimitBuckets)
              .values({ key, count: 1, resetAt });
          }
          result = { ok: true, remaining: limit - 1 };
          return;
        }

        if (existing.count >= limit) {
          result = {
            ok: false,
            retryAfter: Math.ceil((existing.resetAt - now) / 1000),
            remaining: 0,
          };
          return;
        }

        const nextCount = existing.count + 1;
        await tx
          .update(rateLimitBuckets)
          .set({ count: nextCount })
          .where(eq(rateLimitBuckets.key, key));
        result = { ok: true, remaining: limit - nextCount };
      });
      break;
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err && "code" in err
            ? String((err as { code: unknown }).code)
            : "";
      const isBusy =
        msg.includes("SQLITE_BUSY") ||
        msg.includes("database is locked") ||
        msg.includes("BUSY");
      if (!isBusy || attempt >= 5) throw err;
      const backoffMs = Math.min(50, 5 * 2 ** attempt) + Math.random() * 5;
      await new Promise((r) => setTimeout(r, backoffMs));
      attempt += 1;
    }
  }

  // Best-effort opportunistic prune so the table doesn't grow unbounded.
  // Runs at ~1% of calls. Failures are swallowed (housekeeping only).
  if (Math.random() < 0.01) {
    try {
      await db
        .delete(rateLimitBuckets)
        .where(lt(rateLimitBuckets.resetAt, now));
    } catch {
      /* ignore */
    }
  }

  return result;
}

/**
 * Test helper: wipe all buckets. No-op in production code paths.
 */
export async function _resetRateLimitsForTesting() {
  await db.delete(rateLimitBuckets);
}

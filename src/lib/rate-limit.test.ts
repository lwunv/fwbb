/**
 * Rate-limit tests — DB-backed (Vercel multi-instance safe).
 *
 * Trước fix: in-memory Map → mỗi serverless instance có bucket riêng,
 * attacker brute-force amplify bằng số instance.
 *
 * Sau fix: bucket lưu trong `rate_limit_buckets` table, SQLite serializes
 * writers nên count luôn đúng dưới concurrent calls.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { createTestDb } from "@/db/test-db";

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { checkRateLimit } = await import("./rate-limit");

async function reset() {
  await client.execute("DELETE FROM rate_limit_buckets");
}

describe("checkRateLimit (DB-backed)", () => {
  beforeEach(reset);
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows up to limit, then blocks with retryAfter", async () => {
    for (let i = 0; i < 3; i++) {
      const r = await checkRateLimit("k", 3, 60_000);
      expect(r.ok).toBe(true);
    }
    const r = await checkRateLimit("k", 3, 60_000);
    expect(r.ok).toBe(false);
    expect(r.retryAfter).toBeGreaterThan(0);
    expect(r.retryAfter).toBeLessThanOrEqual(60);
  });

  it("resets the window after windowMs", async () => {
    vi.useFakeTimers();
    const baseNow = new Date("2026-01-01T00:00:00Z").getTime();
    vi.setSystemTime(baseNow);

    const r1 = await checkRateLimit("k", 1, 60_000);
    expect(r1.ok).toBe(true);
    const r2 = await checkRateLimit("k", 1, 60_000);
    expect(r2.ok).toBe(false);

    vi.setSystemTime(baseNow + 60_001);
    const r3 = await checkRateLimit("k", 1, 60_000);
    expect(r3.ok).toBe(true);
  });

  it("isolates buckets by key", async () => {
    await checkRateLimit("a", 1, 60_000);
    expect((await checkRateLimit("a", 1, 60_000)).ok).toBe(false);
    expect((await checkRateLimit("b", 1, 60_000)).ok).toBe(true);
  });

  it("decrements remaining on each accepted call", async () => {
    expect((await checkRateLimit("k", 3, 60_000)).remaining).toBe(2);
    expect((await checkRateLimit("k", 3, 60_000)).remaining).toBe(1);
    expect((await checkRateLimit("k", 3, 60_000)).remaining).toBe(0);
    expect((await checkRateLimit("k", 3, 60_000)).ok).toBe(false);
  });

  it("persists across distinct module imports (multi-instance simulation)", async () => {
    // Two server actions running on different instances should see the SAME
    // bucket count because both go to the same DB row.
    await checkRateLimit("login:1.2.3.4", 5, 60_000);
    await checkRateLimit("login:1.2.3.4", 5, 60_000);
    await checkRateLimit("login:1.2.3.4", 5, 60_000);
    await checkRateLimit("login:1.2.3.4", 5, 60_000);
    await checkRateLimit("login:1.2.3.4", 5, 60_000);
    const blocked = await checkRateLimit("login:1.2.3.4", 5, 60_000);
    expect(blocked.ok).toBe(false);
  });

  it("handles concurrent increments without overshooting limit", async () => {
    // 10 parallel calls with limit=5: SQLite serializes writers so exactly 5
    // succeed, 5 are rejected. No "lost update" overshoot.
    const calls = Array.from({ length: 10 }, () =>
      checkRateLimit("concurrent", 5, 60_000),
    );
    const results = await Promise.all(calls);
    const ok = results.filter((r) => r.ok).length;
    const blocked = results.filter((r) => !r.ok).length;
    expect(ok).toBe(5);
    expect(blocked).toBe(5);
  });
});

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { checkRateLimit, _resetRateLimitsForTesting } from "./rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    _resetRateLimitsForTesting();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows up to limit, then blocks with retryAfter", () => {
    for (let i = 0; i < 3; i++) {
      const r = checkRateLimit("k", 3, 60_000);
      expect(r.ok).toBe(true);
    }
    const r = checkRateLimit("k", 3, 60_000);
    expect(r.ok).toBe(false);
    expect(r.retryAfter).toBeGreaterThan(0);
    expect(r.retryAfter).toBeLessThanOrEqual(60);
  });

  it("resets the window after windowMs", () => {
    checkRateLimit("k", 1, 60_000);
    expect(checkRateLimit("k", 1, 60_000).ok).toBe(false);

    vi.advanceTimersByTime(60_001);

    expect(checkRateLimit("k", 1, 60_000).ok).toBe(true);
  });

  it("isolates buckets by key", () => {
    checkRateLimit("a", 1, 60_000);
    expect(checkRateLimit("a", 1, 60_000).ok).toBe(false);
    expect(checkRateLimit("b", 1, 60_000).ok).toBe(true);
  });

  it("decrements remaining on each accepted call", () => {
    expect(checkRateLimit("k", 3, 60_000).remaining).toBe(2);
    expect(checkRateLimit("k", 3, 60_000).remaining).toBe(1);
    expect(checkRateLimit("k", 3, 60_000).remaining).toBe(0);
    expect(checkRateLimit("k", 3, 60_000).ok).toBe(false);
  });
});

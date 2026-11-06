import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const store = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  set: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) =>
      store.jar.has(n) ? { name: n, value: store.jar.get(n) } : undefined,
    set: store.set,
  }),
}));

const {
  COMMENT_PASS_COOKIE,
  sealCommentPass,
  openCommentPass,
  hasCommentPass,
  grantCommentPass,
} = await import("./comment-pass");

const NOW = new Date("2026-11-06T10:00:00.000Z");
const HOUR = 3_600_000;

beforeEach(() => {
  vi.stubEnv("USER_COOKIE_SECRET", "test-secret-at-least-16-chars-long");
  store.jar.clear();
  store.set.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("comment pass", () => {
  it("pass: valid for the same member within 12h", () => {
    const raw = sealCommentPass(7, NOW);
    expect(COMMENT_PASS_COOKIE).toBe("fwbb_xcp");
    expect(openCommentPass(raw, 7, NOW)).toBe(true);
    expect(openCommentPass(raw, 7, new Date(NOW.getTime() + 11 * HOUR))).toBe(
      true,
    );
  });

  it("pass: another member, expired, future, tampered, malformed, missing secret → false", () => {
    const raw = sealCommentPass(7, NOW);
    expect(openCommentPass(raw, 8, NOW)).toBe(false);
    expect(openCommentPass(raw, 7, new Date(NOW.getTime() + 13 * HOUR))).toBe(
      false,
    );
    // Cấp ở tương lai quá 60 giây so với đồng hồ hiện tại.
    const future = sealCommentPass(7, new Date(NOW.getTime() + 5 * 60_000));
    expect(openCommentPass(future, 7, NOW)).toBe(false);
    const [m, t, sig] = raw.split(".");
    expect(openCommentPass(`${m}.${t}.${"0".repeat(64)}`, 7, NOW)).toBe(false);
    expect(openCommentPass(`${m}.${Number(t) + 1}.${sig}`, 7, NOW)).toBe(false);
    expect(openCommentPass(`${m}.${t}.${sig.slice(0, -2)}`, 7, NOW)).toBe(
      false,
    );
    for (const bad of [undefined, "", "abc", "1.2", "a.b.c", `${raw}.x`]) {
      expect(openCommentPass(bad, 7, NOW)).toBe(false);
    }
    vi.stubEnv("USER_COOKIE_SECRET", "");
    expect(() => openCommentPass(raw, 7, NOW)).not.toThrow();
    expect(openCommentPass(raw, 7, NOW)).toBe(false);
  });

  it("grantCommentPass sets a 12h httpOnly cookie that hasCommentPass accepts", async () => {
    const r = await grantCommentPass(7);
    expect(r).toEqual({ ok: true });
    const [name, value, opts] = store.set.mock.calls[0];
    expect(name).toBe("fwbb_xcp");
    expect(opts).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 43_200,
    });
    store.jar.set(name, value);
    expect(await hasCommentPass(7)).toBe(true);
    expect(await hasCommentPass(8)).toBe(false);
  });

  it("grantCommentPass without secret returns ok false", async () => {
    vi.stubEnv("USER_COOKIE_SECRET", "");
    expect(await grantCommentPass(7)).toEqual({ ok: false });
    expect(store.set).not.toHaveBeenCalled();
  });
});

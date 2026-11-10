import { describe, it, expect, vi } from "vitest";

// Chỉ kiểm danh sách export: không cần DB thật, chỉ cần import được module.
vi.mock("@/db", () => ({ db: {} }));
vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
}));

describe("server action boundary", () => {
  it(
    "referrals exports exactly ensureMyPublicCode, getMyReferralState, referMember",
    { timeout: 30_000 },
    async () => {
      const keys = Object.keys(await import("./referrals")).sort();
      expect(keys).toEqual([
        "ensureMyPublicCode",
        "getMyReferralState",
        "referMember",
      ]);
    },
  );
});

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

// Phần ghi (Task 8) và phần đọc (Task 9) cùng nằm trong một file action.
const EXPECTED = ["getMyVenueReview", "listVenueReviews", "submitVenueReview"];

describe("server action boundary", () => {
  it(
    "venue-reviews exports exactly getMyVenueReview, listVenueReviews, submitVenueReview",
    { timeout: 30_000 },
    async () => {
      const keys = Object.keys(await import("./venue-reviews")).sort();
      expect(keys).toEqual(EXPECTED);
    },
  );
});

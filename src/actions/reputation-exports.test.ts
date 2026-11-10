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
    "reputation exports exactly getEventFeedbackForm and submitEventFeedback",
    { timeout: 30_000 },
    async () => {
      const keys = Object.keys(await import("./reputation")).sort();
      expect(keys).toEqual(["getEventFeedbackForm", "submitEventFeedback"]);
    },
  );
});

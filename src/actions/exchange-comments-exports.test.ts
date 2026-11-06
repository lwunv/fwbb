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
    "exchange-comments exports exactly the ten listed actions; exchange-mine exports only getMyExchanges",
    { timeout: 30_000 },
    async () => {
      const comments = Object.keys(await import("./exchange-comments")).sort();
      expect(comments).toEqual(
        [
          "addComment",
          "editComment",
          "deleteComment",
          "toggleCommentVote",
          "pinComment",
          "setCommentsLocked",
          "approveHeldComment",
          "listExchangeComments",
          "listCommentReplies",
          "markCommentsRead",
        ].sort(),
      );
      expect(Object.keys(await import("./exchange-mine"))).toEqual([
        "getMyExchanges",
      ]);
    },
  );
});

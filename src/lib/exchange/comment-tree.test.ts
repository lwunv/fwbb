import { describe, it, expect } from "vitest";
import { buildThreads, type CommentRow } from "./comment-tree";
import { COMMENT_EDIT_WINDOW_MS } from "./constants";

const NOW = new Date("2026-11-06T12:00:00.000Z");
let seq = 0;
function row(p: Partial<CommentRow> = {}): CommentRow {
  seq += 1;
  return {
    id: seq,
    parentId: null,
    channel: "qa",
    authorMemberId: 10,
    authorName: "An",
    authorAvatarUrl: null,
    authorAvatarKey: null,
    replyToName: null,
    body: "hi",
    status: "visible",
    upvotes: 0,
    pinned: false,
    editedAt: null,
    createdAt: "2026-11-06T11:59:00.000Z",
    replyCount: 0,
    ...p,
  };
}
const opts = (o: Partial<Parameters<typeof buildThreads>[1]> = {}) => ({
  hostMemberId: 1,
  viewerId: 10 as number | null,
  isHost: false,
  myVotes: new Set<number>(),
  sort: "top" as const,
  now: NOW,
  writeOpen: true,
  ...o,
});

describe("buildThreads", () => {
  it("pinned root first, then top sort by upvotes", () => {
    const a = row({ id: 1, upvotes: 1 });
    const b = row({ id: 2, upvotes: 5 });
    const c = row({ id: 3, upvotes: 0, pinned: true });
    const d = row({ id: 4, upvotes: 5, createdAt: "2026-11-06T11:00:00.000Z" });
    expect(buildThreads([a, b, c, d], opts()).map((v) => v.id)).toEqual([
      3, 4, 2, 1,
    ]);
  });

  it("new sort puts the newest root first, replies stay oldest first", () => {
    const a = row({ id: 1, createdAt: "2026-11-06T10:00:00.000Z" });
    const b = row({ id: 2, createdAt: "2026-11-06T11:00:00.000Z" });
    const r1 = row({
      id: 3,
      parentId: 1,
      createdAt: "2026-11-06T10:30:00.000Z",
    });
    const r2 = row({
      id: 4,
      parentId: 1,
      createdAt: "2026-11-06T10:10:00.000Z",
    });
    const out = buildThreads([a, b, r1, r2], opts({ sort: "new" }));
    expect(out.map((v) => v.id)).toEqual([2, 1]);
    expect(out[1].replies.map((v) => v.id)).toEqual([4, 3]);
  });

  it("deleted leaf is dropped; deleted, hidden or held root with a visible reply shows a placeholder without author or body", () => {
    const leaf = row({
      id: 1,
      status: "deleted",
      body: null,
      authorName: null,
      authorMemberId: null,
    });
    const del = row({
      id: 2,
      status: "deleted",
      body: null,
      authorName: null,
      authorMemberId: null,
    });
    const hid = row({
      id: 3,
      status: "hidden",
      body: null,
      authorName: null,
      authorMemberId: null,
    });
    const hel = row({
      id: 4,
      status: "held",
      body: null,
      authorName: null,
      authorMemberId: null,
    });
    const kids = [2, 3, 4].map((p) => row({ id: 10 + p, parentId: p }));
    const out = buildThreads(
      [leaf, del, hid, hel, ...kids],
      opts({ sort: "new" }),
    );
    expect(out.map((v) => v.id).sort()).toEqual([2, 3, 4]);
    for (const v of out) {
      expect(v.author).toBeNull();
      expect(v.body).toBeNull();
      expect(v.canDelete).toBe(false);
      expect(v.replies).toHaveLength(1);
    }
    expect(out.find((v) => v.id === 4)?.state).toBe("held");
  });

  it("full held row shows to its author and the host", () => {
    const h = row({ id: 1, status: "held", authorMemberId: 10, body: "wait" });
    const asAuthor = buildThreads([h], opts())[0];
    expect(asAuthor.body).toBe("wait");
    expect(asAuthor.mine).toBe(true);
    expect(asAuthor.canDelete).toBe(true);
    expect(asAuthor.canApprove).toBe(false);
    const asHost = buildThreads([h], opts({ viewerId: 1, isHost: true }))[0];
    expect(asHost.body).toBe("wait");
    expect(asHost.canApprove).toBe(true);
    expect(asHost.canDelete).toBe(true);
    expect(asHost.canPin).toBe(false);
  });

  it("canEdit false after 10 minutes and when writing is closed", () => {
    const fresh = row({ id: 1 });
    const old = row({
      id: 2,
      createdAt: new Date(
        NOW.getTime() - COMMENT_EDIT_WINDOW_MS - 1,
      ).toISOString(),
    });
    const edge = row({
      id: 3,
      createdAt: new Date(NOW.getTime() - COMMENT_EDIT_WINDOW_MS).toISOString(),
    });
    const byId = (o = opts()) =>
      Object.fromEntries(
        buildThreads([fresh, old, edge], o).map((v) => [v.id, v]),
      );
    expect(byId()[1].canEdit).toBe(true);
    expect(byId()[2].canEdit).toBe(false);
    expect(byId()[3].canEdit).toBe(true);
    expect(byId(opts({ writeOpen: false }))[1].canEdit).toBe(false);
  });

  it("moreReplies counts children not on the page", () => {
    const root = row({ id: 1, replyCount: 5 });
    const kids = [row({ id: 2, parentId: 1 }), row({ id: 3, parentId: 1 })];
    const out = buildThreads([root, ...kids], opts());
    expect(out[0].moreReplies).toBe(3);
    expect(out[0].replies).toHaveLength(2);
  });

  it("orphan replies are dropped", () => {
    const out = buildThreads(
      [row({ id: 1 }), row({ id: 2, parentId: 99 })],
      opts(),
    );
    expect(out.map((v) => v.id)).toEqual([1]);
  });

  it("output contains no member id field", () => {
    const root = row({ id: 1, authorMemberId: 1, pinned: true });
    const kid = row({ id: 2, parentId: 1, authorMemberId: 10 });
    const out = buildThreads([root, kid], opts({ myVotes: new Set([2]) }));
    expect(out[0].author?.isHost).toBe(true);
    expect(out[0].replies[0].myVote).toBe(true);
    const keys: string[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object")
        for (const [k, x] of Object.entries(v)) {
          keys.push(k);
          walk(x);
        }
    };
    walk(out);
    expect(keys.filter((k) => /member/i.test(k))).toEqual([]);
    expect(JSON.stringify(out)).not.toContain('"authorMemberId"');
  });
});

describe("buildThreads moreReplies with non-visible children", () => {
  it("held child on the page does not hide an unseen visible reply", () => {
    const root = row({ id: 1, replyCount: 3 });
    const kids = [
      row({ id: 2, parentId: 1 }),
      row({ id: 3, parentId: 1 }),
      row({ id: 4, parentId: 1, status: "held", authorMemberId: 10 }),
    ];
    const out = buildThreads([root, ...kids], opts());
    expect(out[0].replies).toHaveLength(3);
    expect(out[0].moreReplies).toBe(1);
  });
});

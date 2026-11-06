import { describe, it, expect, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  exchangeComments,
  exchangeEvents,
  exchangeRegistrations,
  hostBlocks,
  members,
  venues,
} from "@/db/schema";

// In-memory cache keyed by keyParts, like the real Data Cache: the wrapper is
// rebuilt on every call, so only the key decides whether the body runs again.
const cacheStore = vi.hoisted(() => new Map<string, string>());
const cacheCalls = vi.hoisted(
  () => [] as { keyParts: string[]; opts: unknown }[],
);
vi.mock("next/cache", () => ({
  unstable_cache:
    <A extends unknown[], R>(
      fn: (...a: A) => Promise<R>,
      keyParts: string[],
      opts: unknown,
    ) =>
    async (...a: A): Promise<R> => {
      cacheCalls.push({ keyParts, opts });
      const key = JSON.stringify([keyParts, a]);
      const hit = cacheStore.get(key);
      if (hit !== undefined) return JSON.parse(hit) as R;
      const out = await fn(...a);
      cacheStore.set(key, JSON.stringify(out ?? null));
      return out;
    },
}));

const { db: testDb } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const {
  commentTag,
  commentMetaTag,
  commentWriteState,
  getCommentEventMetaCached,
  loadCommentContext,
  loadCommentInEvent,
  loadCommentWithContext,
} = await import("./comment-access");

const NOW = new Date("2026-11-06T00:00:00.000Z");
const DAY = 86_400_000;
const iso = (offsetDays: number) =>
  new Date(NOW.getTime() + offsetDays * DAY).toISOString();

const [venue] = await testDb
  .insert(venues)
  .values({ name: "V", lat: 10, lng: 106, status: "approved" })
  .returning();

async function seedMember(
  name: string,
  o: Partial<typeof members.$inferInsert> = {},
) {
  const [m] = await testDb
    .insert(members)
    .values({ name, approvalStatus: "approved", ...o })
    .returning();
  return m;
}
const host = await seedMember("Host");
const stranger = await seedMember("Stranger");
// Tài khoản mới đăng ký, admin chưa duyệt.
const pendingAccount = await seedMember("Pending", {
  approvalStatus: "pending",
});
const alice = await seedMember("Alice");
const bob = await seedMember("Bob");

let seq = 0;
async function seedEvent(o: Partial<typeof exchangeEvents.$inferInsert> = {}) {
  seq += 1;
  const [e] = await testDb
    .insert(exchangeEvents)
    .values({
      publicCode: `cm${String(seq).padStart(6, "0")}`,
      hostMemberId: host.id,
      venueId: venue.id,
      title: `t${seq}`,
      startAt: iso(-1),
      endAt: iso(0),
      slotsTotal: 10,
      feeMode: "fixed",
      feeAmountMale: 50_000,
      registerDeadline: iso(-2),
      cancelDeadline: iso(-2),
      createdAt: iso(-3),
      updatedAt: iso(-3),
      ...o,
    })
    .returning();
  return e;
}
async function seedReg(
  eventId: number,
  memberId: number,
  status: (typeof exchangeRegistrations.$inferInsert)["status"],
) {
  await testDb.insert(exchangeRegistrations).values({
    eventId,
    memberId,
    status,
    maleCount: 1,
    createdAt: iso(-2),
    updatedAt: iso(-2),
  });
}
async function seedComment(
  eventId: number,
  authorMemberId: number,
  o: Partial<typeof exchangeComments.$inferInsert> = {},
) {
  const [c] = await testDb
    .insert(exchangeComments)
    .values({
      eventId,
      channel: "qa",
      authorMemberId,
      body: "hi",
      createdAt: iso(0),
      ...o,
    })
    .returning();
  return c;
}

describe("comment access", () => {
  it("tags and cache key", async () => {
    expect(commentTag(5)).toBe("xcmt:e5");
    expect(commentMetaTag("abc")).toBe("xcmeta:abc");
    const ev = await seedEvent();
    cacheCalls.length = 0;
    await getCommentEventMetaCached(ev.publicCode);
    expect(cacheCalls[0].keyParts).toEqual(["xcmeta", ev.publicCode]);
    expect(cacheCalls[0].opts).toEqual({
      revalidate: 60,
      tags: ["exchange", `xcmeta:${ev.publicCode}`],
    });
  });

  it("write state: hidden or inactive host closes; 7 days after end closes; cancelled counts from cancelledAt; locked only when otherwise open", () => {
    const base = {
      commentsLocked: false,
      hidden: false,
      endAt: iso(-6),
      cancelledAt: null,
    };
    expect(commentWriteState(base, true, NOW)).toBe("open");
    expect(commentWriteState({ ...base, hidden: true }, true, NOW)).toBe(
      "closed",
    );
    expect(commentWriteState(base, false, NOW)).toBe("closed");
    expect(commentWriteState({ ...base, endAt: iso(-8) }, true, NOW)).toBe(
      "closed",
    );
    // Cancelled 2 days ago but the planned end was 20 days ago: still open.
    expect(
      commentWriteState(
        { ...base, endAt: iso(-20), cancelledAt: iso(-2) },
        true,
        NOW,
      ),
    ).toBe("open");
    expect(
      commentWriteState(
        { ...base, endAt: iso(1), cancelledAt: iso(-8) },
        true,
        NOW,
      ),
    ).toBe("closed");
    expect(
      commentWriteState({ ...base, commentsLocked: true }, true, NOW),
    ).toBe("locked");
    expect(
      commentWriteState(
        { ...base, commentsLocked: true, endAt: iso(-8) },
        true,
        NOW,
      ),
    ).toBe("closed");
  });

  it("write state fails closed when the end or cancel date cannot be parsed", () => {
    const base = {
      commentsLocked: false,
      hidden: false,
      endAt: iso(-1),
      cancelledAt: null,
    };
    expect(commentWriteState({ ...base, endAt: "not a date" }, true, NOW)).toBe(
      "closed",
    );
    expect(commentWriteState({ ...base, endAt: "" }, true, NOW)).toBe("closed");
    expect(
      commentWriteState({ ...base, cancelledAt: "garbage" }, true, NOW),
    ).toBe("closed");
    expect(
      commentWriteState(
        { ...base, commentsLocked: true, endAt: "not a date" },
        true,
        NOW,
      ),
    ).toBe("closed");
  });

  it("guest reads qa, not group, writes nothing, and runs no DB query when the meta cache is warm", async () => {
    const ev = await seedEvent();
    await loadCommentContext(testDb, { code: ev.publicCode }, null, NOW);
    const spy = vi.spyOn(testDb, "select");
    const ctx = await loadCommentContext(
      testDb,
      { code: ev.publicCode },
      null,
      NOW,
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(ctx?.role).toBe("guest");
    expect(ctx?.canRead).toEqual({ qa: true, group: false });
    expect(ctx?.canWrite).toEqual({ qa: false, group: false });
    expect(ctx?.blocked).toBe(false);
  });

  it("pending outsider with no registration writes qa only", async () => {
    const ev = await seedEvent();
    const ctx = await loadCommentContext(
      testDb,
      { code: ev.publicCode },
      { id: pendingAccount.id },
      NOW,
    );
    expect(ctx?.role).toBe("member");
    expect(ctx?.canRead).toEqual({ qa: true, group: false });
    expect(ctx?.canWrite).toEqual({ qa: true, group: false });
  });

  it("approved registrant and host read and write both", async () => {
    const ev = await seedEvent();
    await seedReg(ev.id, alice.id, "approved");
    const a = await loadCommentContext(
      testDb,
      { eventId: ev.id },
      { id: alice.id },
      NOW,
    );
    expect(a?.role).toBe("approved");
    expect(a?.canWrite).toEqual({ qa: true, group: true });
    const h = await loadCommentContext(
      testDb,
      { eventId: ev.id },
      { id: host.id },
      NOW,
    );
    expect(h?.role).toBe("host");
    expect(h?.canRead).toEqual({ qa: true, group: true });
    expect(h?.canWrite).toEqual({ qa: true, group: true });
  });

  it("pending, waitlist, cancelled registrants cannot read group", async () => {
    const ev = await seedEvent();
    const m1 = await seedMember("P1");
    const m2 = await seedMember("P2");
    const m3 = await seedMember("P3");
    await seedReg(ev.id, m1.id, "pending");
    await seedReg(ev.id, m2.id, "waitlist");
    await seedReg(ev.id, m3.id, "cancelled");
    for (const m of [m1, m2, m3]) {
      const ctx = await loadCommentContext(
        testDb,
        { eventId: ev.id },
        { id: m.id },
        NOW,
      );
      expect(ctx?.role).toBe("member");
      expect(ctx?.canRead.group).toBe(false);
      expect(ctx?.canWrite.group).toBe(false);
    }
  });

  it("blocked member reads qa but cannot write", async () => {
    const ev = await seedEvent();
    await testDb.insert(hostBlocks).values({
      hostMemberId: host.id,
      blockedMemberId: bob.id,
      createdAt: iso(-1),
    });
    const ctx = await loadCommentContext(
      testDb,
      { eventId: ev.id },
      { id: bob.id },
      NOW,
    );
    expect(ctx?.blocked).toBe(true);
    expect(ctx?.canRead.qa).toBe(true);
    expect(ctx?.canWrite.qa).toBe(false);
  });

  it("hidden event returns null for a stranger and a context for its registrant", async () => {
    const ev = await seedEvent({ hiddenAt: iso(-1) });
    await seedReg(ev.id, alice.id, "pending");
    expect(
      await loadCommentContext(testDb, { code: ev.publicCode }, null, NOW),
    ).toBeNull();
    expect(
      await loadCommentContext(
        testDb,
        { eventId: ev.id },
        { id: stranger.id },
        NOW,
      ),
    ).toBeNull();
    const ctx = await loadCommentContext(
      testDb,
      { eventId: ev.id },
      { id: alice.id },
      NOW,
    );
    expect(ctx?.writeState).toBe("closed");
    expect(ctx?.canWrite.qa).toBe(false);
    expect(ctx?.canRead.qa).toBe(true);
    expect(
      await loadCommentContext(testDb, { eventId: 999_999 }, null, NOW),
    ).toBeNull();
  });

  it("loadCommentInEvent rejects a comment of another event, a group comment for a member, and someone else's held comment", async () => {
    const ev = await seedEvent();
    const other = await seedEvent();
    const ctxMember = (await loadCommentContext(
      testDb,
      { eventId: ev.id },
      { id: stranger.id },
      NOW,
    ))!;
    const ctxHost = (await loadCommentContext(
      testDb,
      { eventId: ev.id },
      { id: host.id },
      NOW,
    ))!;
    const foreign = await seedComment(other.id, alice.id);
    const group = await seedComment(ev.id, alice.id, { channel: "group" });
    const held = await seedComment(ev.id, alice.id, { status: "held" });
    const ok = await seedComment(ev.id, alice.id);

    expect(
      await loadCommentInEvent(testDb, foreign.id, ctxMember, stranger.id),
    ).toBeNull();
    expect(
      await loadCommentInEvent(testDb, group.id, ctxMember, stranger.id),
    ).toBeNull();
    expect(
      await loadCommentInEvent(testDb, held.id, ctxMember, stranger.id),
    ).toBeNull();
    expect(
      await loadCommentInEvent(testDb, held.id, ctxMember, alice.id),
    ).toMatchObject({ id: held.id, status: "held" });
    expect(
      await loadCommentInEvent(testDb, held.id, ctxHost, host.id),
    ).toMatchObject({ id: held.id });
    expect(
      await loadCommentInEvent(testDb, group.id, ctxHost, host.id),
    ).toMatchObject({ channel: "group", eventId: ev.id, pinned: false });
    expect(
      await loadCommentInEvent(testDb, ok.id, ctxMember, null),
    ).toMatchObject({ id: ok.id, parentId: null, authorMemberId: alice.id });
    expect(
      await loadCommentInEvent(testDb, 999_999, ctxHost, host.id),
    ).toBeNull();
  });

  it("author may load own group comment for delete after losing approval", async () => {
    const ev = await seedEvent();
    await seedReg(ev.id, alice.id, "cancelled");
    const group = await seedComment(ev.id, alice.id, { channel: "group" });
    const got = await loadCommentWithContext(
      testDb,
      group.id,
      { id: alice.id },
      NOW,
      { authorAnyChannel: true },
    );
    expect(got?.comment.id).toBe(group.id);
    expect(got?.ctx.role).toBe("member");
    expect(
      await loadCommentWithContext(testDb, group.id, { id: alice.id }, NOW),
    ).toBeNull();
    expect(
      await loadCommentWithContext(testDb, group.id, { id: bob.id }, NOW, {
        authorAnyChannel: true,
      }),
    ).toBeNull();
  });

  it("loadCommentWithContext: a member of another event, a guest, or a pending account never reaches a group comment or someone else's held one", async () => {
    const ev = await seedEvent();
    const other = await seedEvent();
    // Bob duyệt ở buổi khác, không có đăng ký ở `ev`.
    await seedReg(other.id, bob.id, "approved");
    await seedReg(ev.id, alice.id, "approved");
    const group = await seedComment(ev.id, alice.id, { channel: "group" });
    const held = await seedComment(ev.id, alice.id, { status: "held" });
    const ok = await seedComment(ev.id, alice.id);

    for (const viewer of [{ id: bob.id }, { id: pendingAccount.id }, null]) {
      expect(
        await loadCommentWithContext(testDb, group.id, viewer, NOW),
      ).toBeNull();
      expect(
        await loadCommentWithContext(testDb, held.id, viewer, NOW),
      ).toBeNull();
      // Ngữ cảnh luôn là buổi của chính bình luận, không phải buổi người xem có quyền.
      const got = await loadCommentWithContext(testDb, ok.id, viewer, NOW);
      expect(got?.ctx.event.id).toBe(ev.id);
      expect(got?.ctx.canRead.group).toBe(false);
    }
    // Tác giả và host vẫn thấy.
    expect(
      (await loadCommentWithContext(testDb, held.id, { id: alice.id }, NOW))
        ?.comment.status,
    ).toBe("held");
    expect(
      (await loadCommentWithContext(testDb, group.id, { id: host.id }, NOW))
        ?.comment.channel,
    ).toBe("group");
  });

  it("loadCommentWithContext of a comment in another, hidden event is null for outsiders and guests", async () => {
    const hiddenEv = await seedEvent({ hiddenAt: iso(-1) });
    const c = await seedComment(hiddenEv.id, alice.id);
    for (const viewer of [{ id: bob.id }, { id: pendingAccount.id }, null]) {
      expect(
        await loadCommentWithContext(testDb, c.id, viewer, NOW),
      ).toBeNull();
    }
  });
});

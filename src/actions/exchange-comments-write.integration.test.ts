import {
  describe,
  it,
  expect,
  beforeEach,
  beforeAll,
  afterAll,
  vi,
} from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import {
  exchangeComments,
  exchangeEvents,
  exchangeRegistrations,
  hostBlocks,
  members,
  notifications,
  rateLimitBuckets,
  venues,
} from "@/db/schema";

const mocks = vi.hoisted(() => ({
  flag: vi.fn(),
  auth: vi.fn(),
  verify: vi.fn(),
  updateTag: vi.fn(),
  cookies: new Map<string, string>(),
}));
vi.mock("@/lib/exchange-flag", () => ({ isExchangeEnabled: mocks.flag }));
vi.mock("@/lib/member-auth", () => ({ requireExchangeMember: mocks.auth }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: mocks.verify }));
vi.mock("@/lib/client-ip", () => ({
  getTrustedClientIp: async () => "unknown",
  ipRateLimitKey: () => "ip",
  hashedIpKey: () => "ip",
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) =>
      mocks.cookies.has(k) ? { value: mocks.cookies.get(k) } : undefined,
    set: (k: string, v: string) => void mocks.cookies.set(k, v),
  }),
}));
vi.mock("next/cache", () => ({
  updateTag: mocks.updateTag,
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

const { db: testDb } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { addComment, editComment, deleteComment } =
  await import("./exchange-comments");
const { enableNotificationsForTest } =
  await import("@/lib/notifications/test-helpers");

type Member = typeof members.$inferSelect;
const DAY = 86_400_000;
let clock = 0;
const tick = (ms = 11_000) => vi.setSystemTime((clock += ms));
const iso = (offsetMs: number) => new Date(clock + offsetMs).toISOString();

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://fwbb.test");
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const [venue] = await testDb
  .insert(venues)
  .values({ name: "V", lat: 10, lng: 106, status: "approved" })
  .returning();
const [host] = await testDb
  .insert(members)
  .values({ name: "Host", approvalStatus: "approved" })
  .returning();

let seq = 0;
async function newMember(
  over: Partial<typeof members.$inferInsert> = {},
): Promise<Member> {
  seq += 1;
  const [m] = await testDb
    .insert(members)
    .values({ name: `M${seq}`, approvalStatus: "approved", ...over })
    .returning();
  return m;
}
const asMember = (m: Member) =>
  mocks.auth.mockResolvedValue({
    user: { memberId: m.id, externalId: "x" },
    member: m,
  });

let codeSeq = 0;
async function mkEvent(over: Partial<typeof exchangeEvents.$inferInsert> = {}) {
  codeSeq += 1;
  const [ev] = await testDb
    .insert(exchangeEvents)
    .values({
      publicCode: `cw${codeSeq}`,
      hostMemberId: host.id,
      venueId: venue.id,
      title: "Giao luu",
      startAt: iso(10 * DAY),
      endAt: iso(10 * DAY + 2 * 3_600_000),
      slotsTotal: 4,
      feeMode: "fixed",
      feeAmountMale: 50000,
      registerDeadline: iso(9 * DAY),
      cancelDeadline: iso(8 * DAY),
      status: "open",
      createdAt: iso(0),
      updatedAt: iso(0),
      ...over,
    })
    .returning();
  return ev;
}

async function addReg(eventId: number, memberId: number, status = "approved") {
  await testDb.insert(exchangeRegistrations).values({
    eventId,
    memberId,
    status: status as "approved",
    maleCount: 1,
    femaleCount: 0,
    createdAt: iso(0),
    updatedAt: iso(0),
  });
}

async function seedComment(
  over: Partial<typeof exchangeComments.$inferInsert> & {
    eventId: number;
    authorMemberId: number;
  },
) {
  const [row] = await testDb
    .insert(exchangeComments)
    .values({
      channel: "qa",
      body: "seed",
      status: "visible",
      createdAt: iso(0),
      ...over,
    })
    .returning();
  return row;
}

const post = (
  code: string,
  over: Record<string, unknown> = {},
): ReturnType<typeof addComment> =>
  addComment({
    code,
    channel: "qa",
    body: "Hello there",
    idempotencyKey: randomUUID(),
    turnstileToken: "tok",
    ...over,
  });

const rowOf = async (id: number) =>
  (
    await testDb
      .select()
      .from(exchangeComments)
      .where(eq(exchangeComments.id, id))
  )[0];
const allComments = () => testDb.select().from(exchangeComments);
const kinds = async () =>
  (await testDb.select().from(notifications)).map((n) => n.kind);

beforeEach(async () => {
  await testDb.delete(notifications);
  await testDb.delete(exchangeComments);
  await testDb.delete(exchangeRegistrations);
  await testDb.delete(hostBlocks);
  await testDb.delete(exchangeEvents);
  await testDb.delete(rateLimitBuckets);
  await testDb
    .update(members)
    .set({ isActive: true, approvalStatus: "approved" })
    .where(eq(members.id, host.id));
  mocks.cookies.clear();
  mocks.flag.mockReset().mockResolvedValue(true);
  mocks.verify.mockReset().mockResolvedValue({ ok: true });
  mocks.auth.mockReset();
  mocks.updateTag.mockClear();
  vi.stubEnv("USER_COOKIE_SECRET", "test-user-cookie-secret-at-least-16-chars");
  clock = Date.now();
  vi.setSystemTime(clock);
});

describe("addComment", () => {
  it("first comment without a pass asks for captcha and writes nothing", async () => {
    const ev = await mkEvent();
    asMember(await newMember());
    const r = await post(ev.publicCode, { turnstileToken: undefined });
    expect(r).toEqual({ needsCaptcha: true });
    expect(await allComments()).toHaveLength(0);
    expect(await testDb.select().from(rateLimitBuckets)).toHaveLength(0);
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });

  it("comment with a token grants the pass; a second comment 11 seconds later needs no token", async () => {
    const ev = await mkEvent();
    asMember(await newMember());
    const a = await post(ev.publicCode);
    expect("success" in a).toBe(true);
    tick();
    const b = await post(ev.publicCode, { turnstileToken: undefined });
    expect("success" in b).toBe(true);
    expect(mocks.verify).toHaveBeenCalledTimes(1);
    expect(mocks.updateTag).toHaveBeenCalledWith(`xcmt:e${ev.id}`);
    expect(mocks.updateTag).not.toHaveBeenCalledWith("exchange");
  });

  it("failed Turnstile writes no row and no rate-limit bucket", async () => {
    const ev = await mkEvent();
    asMember(await newMember());
    mocks.verify.mockResolvedValue({ ok: false, reason: "failed" });
    const r = await post(ev.publicCode);
    expect(r).toEqual({ error: "captcha" });
    expect(await allComments()).toHaveLength(0);
    expect(await testDb.select().from(rateLimitBuckets)).toHaveLength(0);
    expect(mocks.cookies.size).toBe(0);
  });

  it("missing USER_COOKIE_SECRET after Turnstile returns the config error and writes nothing", async () => {
    const ev = await mkEvent();
    asMember(await newMember());
    vi.stubEnv("USER_COOKIE_SECRET", "");
    const r = await post(ev.publicCode);
    expect(r).toEqual({ error: "config" });
    expect(await allComments()).toHaveLength(0);
  });

  it("second comment within 10 seconds is rate limited", async () => {
    const ev = await mkEvent();
    asMember(await newMember());
    expect("success" in (await post(ev.publicCode))).toBe(true);
    const r = await post(ev.publicCode);
    expect(r).toEqual({ error: "rateLimited" });
    expect(await allComments()).toHaveLength(1);
  });

  it("resending the same idempotencyKey within 10 seconds returns the first row, not a rate-limit error", async () => {
    const ev = await mkEvent();
    asMember(await newMember());
    const idempotencyKey = randomUUID();
    const a = await post(ev.publicCode, { idempotencyKey });
    const b = await post(ev.publicCode, { idempotencyKey });
    expect(b).toEqual(a);
    expect(await allComments()).toHaveLength(1);
    expect(mocks.updateTag).toHaveBeenCalledTimes(1);
  });

  it("host posts 3 replies in 20 seconds in their own event", async () => {
    const ev = await mkEvent();
    const other = await newMember();
    const root = await seedComment({
      eventId: ev.id,
      authorMemberId: other.id,
    });
    asMember(host);
    for (let i = 0; i < 3; i++) {
      const r = await post(ev.publicCode, { parentId: root.id });
      expect("success" in r).toBe(true);
      tick(5_000);
    }
    expect(await allComments()).toHaveLength(4);
  });

  it("new outsider stops at 5 a day, approved group member at 30", async () => {
    const ev = await mkEvent();
    const outsider = await newMember({ approvalStatus: "pending" });
    asMember(outsider);
    for (let i = 0; i < 5; i++) {
      expect("success" in (await post(ev.publicCode))).toBe(true);
      tick();
    }
    expect(await post(ev.publicCode)).toEqual({ error: "rateLimited" });

    const regular = await newMember();
    asMember(regular);
    for (let i = 0; i < 30; i++) {
      expect("success" in (await post(ev.publicCode))).toBe(true);
      tick();
    }
    expect(await post(ev.publicCode)).toEqual({ error: "rateLimited" });
  });

  it("qa comment with a phone is held, the host's own is visible, a group one is visible", async () => {
    const ev = await mkEvent();
    const m = await newMember();
    await addReg(ev.id, m.id);
    asMember(m);
    const held = await post(ev.publicCode, { body: "goi 0912345678 nhe" });
    expect(held).toMatchObject({ success: true, data: { status: "held" } });
    tick();
    const grp = await post(ev.publicCode, {
      channel: "group",
      body: "goi 0912345678 nhe",
    });
    expect(grp).toMatchObject({ success: true, data: { status: "visible" } });
    asMember(host);
    tick();
    const own = await post(ev.publicCode, { body: "zalo.me/abc" });
    expect(own).toMatchObject({ success: true, data: { status: "visible" } });
  });

  it("reply to a tier-2 reply is stored under its tier-1 parent with replyToMemberId", async () => {
    const ev = await mkEvent();
    const [a, b, c, d] = [
      await newMember(),
      await newMember(),
      await newMember(),
      await newMember(),
    ];
    const root = await seedComment({ eventId: ev.id, authorMemberId: a.id });
    const t1 = await seedComment({
      eventId: ev.id,
      authorMemberId: b.id,
      parentId: root.id,
    });
    const t2 = await seedComment({
      eventId: ev.id,
      authorMemberId: c.id,
      parentId: t1.id,
      replyToMemberId: b.id,
    });
    asMember(d);
    const r = await post(ev.publicCode, { parentId: t2.id });
    if (!("success" in r)) throw new Error("expected success");
    const row = await rowOf(r.data.id);
    expect(row.parentId).toBe(t1.id);
    expect(row.replyToMemberId).toBe(c.id);

    tick();
    const r2 = await post(ev.publicCode, { parentId: t1.id });
    if (!("success" in r2)) throw new Error("expected success");
    expect((await rowOf(r2.data.id)).parentId).toBe(t1.id);
  });

  it("parentId from another event, the other channel, or someone else's held comment is rejected with no notification", async () => {
    await enableNotificationsForTest(testDb);
    const ev = await mkEvent();
    const ev2 = await mkEvent();
    const other = await newMember();
    const me = await newMember();
    await addReg(ev.id, me.id);
    const foreign = await seedComment({
      eventId: ev2.id,
      authorMemberId: other.id,
    });
    const grp = await seedComment({
      eventId: ev.id,
      authorMemberId: other.id,
      channel: "group",
    });
    const held = await seedComment({
      eventId: ev.id,
      authorMemberId: other.id,
      status: "held",
    });
    asMember(me);
    for (const parentId of [foreign.id, grp.id, held.id, 999_999]) {
      const r = await post(ev.publicCode, { parentId });
      expect(r).toEqual({ error: "commentNotFound" });
      tick();
    }
    expect(await allComments()).toHaveLength(3);
    expect(await kinds()).toEqual([]);
  });

  it("member without group access cannot post or reply in group, also when sending channel group", async () => {
    const ev = await mkEvent();
    const other = await newMember();
    const m = await newMember();
    const grp = await seedComment({
      eventId: ev.id,
      authorMemberId: other.id,
      channel: "group",
    });
    asMember(m);
    expect(await post(ev.publicCode, { channel: "group" })).toEqual({
      error: "cannotComment",
    });
    tick();
    expect(
      await post(ev.publicCode, { channel: "group", parentId: grp.id }),
    ).toEqual({ error: "cannotComment" });
    tick();
    expect(await post(ev.publicCode, { parentId: grp.id })).toEqual({
      error: "commentNotFound",
    });
    expect(await allComments()).toHaveLength(1);
  });

  it("blocked member gets the generic error and cannot edit", async () => {
    const ev = await mkEvent();
    const m = await newMember();
    const mine = await seedComment({
      eventId: ev.id,
      authorMemberId: m.id,
      createdAt: iso(0),
    });
    await testDb.insert(hostBlocks).values({
      hostMemberId: host.id,
      blockedMemberId: m.id,
      createdAt: iso(0),
    });
    asMember(m);
    expect(await post(ev.publicCode)).toEqual({ error: "cannotComment" });
    expect(await editComment({ commentId: mine.id, body: "new" })).toEqual({
      error: "cannotComment",
    });
    expect((await rowOf(mine.id)).body).toBe("seed");
  });

  it("locked, hidden, 7 days after end → rejected", async () => {
    const m = await newMember();
    asMember(m);
    const locked = await mkEvent({ commentsLocked: true });
    expect(await post(locked.publicCode)).toEqual({ error: "commentsLocked" });
    tick();
    const hidden = await mkEvent({ hiddenAt: iso(0) });
    expect("error" in (await post(hidden.publicCode))).toBe(true);
    tick();
    const old = await mkEvent({
      startAt: iso(-8 * DAY - 7_200_000),
      endAt: iso(-8 * DAY),
      status: "done",
    });
    expect(await post(old.publicCode)).toEqual({ error: "commentsClosed" });
    expect(await allComments()).toHaveLength(0);
  });

  it("cap of 500 per channel", async () => {
    const ev = await mkEvent();
    const other = await newMember();
    for (let i = 0; i < 5; i++) {
      await testDb.insert(exchangeComments).values(
        Array.from({ length: 100 }, () => ({
          eventId: ev.id,
          channel: "qa" as const,
          authorMemberId: other.id,
          body: "x",
          createdAt: iso(0),
        })),
      );
    }
    asMember(await newMember());
    expect(await post(ev.publicCode)).toEqual({ error: "commentCapReached" });
  });

  it("flag off errors before any DB read", async () => {
    mocks.flag.mockResolvedValue(false);
    const r = await post("whatever");
    expect(r).toEqual({ error: "notFound" });
    expect(mocks.auth).not.toHaveBeenCalled();
  });
});

describe("editComment", () => {
  it("edit within 10 seconds of posting is allowed", async () => {
    const ev = await mkEvent();
    const m = await newMember();
    asMember(m);
    const r = await post(ev.publicCode);
    if (!("success" in r)) throw new Error("expected success");
    tick(5_000);
    expect(
      await editComment({ commentId: r.data.id, body: "  fixed  " }),
    ).toEqual({
      success: true,
    });
    const row = await rowOf(r.data.id);
    expect(row.body).toBe("fixed");
    expect(row.editedAt).not.toBeNull();
  });

  it("edit after 10 minutes rejected; edit adding a link moves it to held and unpins it", async () => {
    const ev = await mkEvent();
    const m = await newMember();
    asMember(m);
    const old = await seedComment({
      eventId: ev.id,
      authorMemberId: m.id,
      createdAt: iso(-11 * 60_000),
    });
    expect(await editComment({ commentId: old.id, body: "x" })).toEqual({
      error: "commentEditExpired",
    });
    const fresh = await seedComment({
      eventId: ev.id,
      authorMemberId: m.id,
      pinned: true,
    });
    expect(
      await editComment({ commentId: fresh.id, body: "xem zalo.me/abc" }),
    ).toEqual({ success: true });
    const row = await rowOf(fresh.id);
    expect(row.status).toBe("held");
    expect(row.pinned).toBe(false);
  });

  it("edit removing the link from a held reply notifies the parent author", async () => {
    await enableNotificationsForTest(testDb);
    const ev = await mkEvent();
    const p = await newMember();
    const a = await newMember();
    const root = await seedComment({ eventId: ev.id, authorMemberId: p.id });
    const reply = await seedComment({
      eventId: ev.id,
      authorMemberId: a.id,
      parentId: root.id,
      replyToMemberId: p.id,
      status: "held",
      body: "zalo.me/abc",
    });
    asMember(a);
    expect(await editComment({ commentId: reply.id, body: "clean" })).toEqual({
      success: true,
    });
    expect((await rowOf(reply.id)).status).toBe("visible");
    const rows = await testDb.select().from(notifications);
    expect(
      rows.some(
        (n) => n.kind === "exchange_comment_reply" && n.recipientId === p.id,
      ),
    ).toBe(true);
  });

  it("edit by someone else rejected", async () => {
    const ev = await mkEvent();
    const a = await newMember();
    const b = await newMember();
    const c = await seedComment({ eventId: ev.id, authorMemberId: a.id });
    asMember(b);
    expect(await editComment({ commentId: c.id, body: "hack" })).toEqual({
      error: "cannotComment",
    });
    expect((await rowOf(c.id)).body).toBe("seed");
  });
});

describe("deleteComment", () => {
  it("host deletes another's comment; a member cannot", async () => {
    const ev = await mkEvent();
    const a = await newMember();
    const b = await newMember();
    const c = await seedComment({ eventId: ev.id, authorMemberId: a.id });
    asMember(b);
    expect(await deleteComment({ commentId: c.id })).toEqual({
      error: "cannotComment",
    });
    expect((await rowOf(c.id)).status).toBe("visible");
    asMember(host);
    expect(await deleteComment({ commentId: c.id })).toEqual({ success: true });
    expect((await rowOf(c.id)).status).toBe("deleted");
    expect(mocks.updateTag).toHaveBeenCalledWith(`xcmt:e${ev.id}`);
  });

  it("author deletes own group comment after losing approval", async () => {
    const ev = await mkEvent();
    const a = await newMember();
    await addReg(ev.id, a.id, "cancelled");
    const c = await seedComment({
      eventId: ev.id,
      authorMemberId: a.id,
      channel: "group",
    });
    asMember(a);
    expect(await deleteComment({ commentId: c.id })).toEqual({ success: true });
    expect((await rowOf(c.id)).status).toBe("deleted");
  });

  it("delete keeps replies and unpins", async () => {
    const ev = await mkEvent({ commentsLocked: true });
    const a = await newMember();
    const b = await newMember();
    const root = await seedComment({
      eventId: ev.id,
      authorMemberId: a.id,
      pinned: true,
    });
    const reply = await seedComment({
      eventId: ev.id,
      authorMemberId: b.id,
      parentId: root.id,
    });
    asMember(a);
    expect(await deleteComment({ commentId: root.id })).toEqual({
      success: true,
    });
    const r = await rowOf(root.id);
    expect(r.status).toBe("deleted");
    expect(r.pinned).toBe(false);
    expect((await rowOf(reply.id)).status).toBe("visible");
  });
});

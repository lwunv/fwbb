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
  exchangeCommentVotes,
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

const {
  addComment,
  deleteComment,
  toggleCommentVote,
  pinComment,
  setCommentsLocked,
  approveHeldComment,
} = await import("./exchange-comments");
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

beforeEach(async () => {
  await testDb.delete(notifications);
  await testDb.delete(exchangeCommentVotes);
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

const votesOf = async (id: number) => (await rowOf(id)).upvotes;
const voteRows = () => testDb.select().from(exchangeCommentVotes);

describe("toggleCommentVote", () => {
  it("vote true twice counts once; false twice never goes below 0", async () => {
    const ev = await mkEvent();
    const author = await newMember();
    const c = await seedComment({ eventId: ev.id, authorMemberId: author.id });
    asMember(await newMember());
    await toggleCommentVote({ commentId: c.id, voted: true });
    const r = await toggleCommentVote({ commentId: c.id, voted: true });
    expect(r).toEqual({ success: true, data: { upvotes: 1 } });
    expect(await voteRows()).toHaveLength(1);
    await toggleCommentVote({ commentId: c.id, voted: false });
    const z = await toggleCommentVote({ commentId: c.id, voted: false });
    expect(z).toEqual({ success: true, data: { upvotes: 0 } });
    expect(await votesOf(c.id)).toBe(0);
  });

  it("two members voting at once both count", async () => {
    const ev = await mkEvent();
    const author = await newMember();
    const c = await seedComment({ eventId: ev.id, authorMemberId: author.id });
    const [a, b] = [await newMember(), await newMember()];
    const as = (m: Member) => ({
      user: { memberId: m.id, externalId: "x" },
      member: m,
    });
    mocks.auth.mockResolvedValueOnce(as(a)).mockResolvedValueOnce(as(b));
    const pa = toggleCommentVote({ commentId: c.id, voted: true });
    const pb = toggleCommentVote({ commentId: c.id, voted: true });
    await Promise.all([pa, pb]);
    expect(await votesOf(c.id)).toBe(2);
    expect(await voteRows()).toHaveLength(2);
  });

  it("cannot vote own comment, someone else's held one, a deleted one, or a group comment without access", async () => {
    const ev = await mkEvent();
    const author = await newMember();
    const viewer = await newMember();
    const own = await seedComment({
      eventId: ev.id,
      authorMemberId: viewer.id,
    });
    const held = await seedComment({
      eventId: ev.id,
      authorMemberId: author.id,
      status: "held",
    });
    const gone = await seedComment({
      eventId: ev.id,
      authorMemberId: author.id,
      status: "deleted",
    });
    const grp = await seedComment({
      eventId: ev.id,
      authorMemberId: author.id,
      channel: "group",
    });
    asMember(viewer);
    for (const c of [own, held, gone, grp]) {
      const r = await toggleCommentVote({ commentId: c.id, voted: true });
      expect("error" in r).toBe(true);
    }
    expect(await voteRows()).toHaveLength(0);
  });

  it("vote allowed while locked, refused when closed", async () => {
    const ev = await mkEvent({ commentsLocked: true });
    const author = await newMember();
    const c = await seedComment({ eventId: ev.id, authorMemberId: author.id });
    asMember(await newMember());
    const ok = await toggleCommentVote({ commentId: c.id, voted: true });
    expect("success" in ok).toBe(true);

    const old = await mkEvent({
      startAt: iso(-20 * DAY),
      endAt: iso(-10 * DAY),
      registerDeadline: iso(-21 * DAY),
      cancelDeadline: iso(-22 * DAY),
    });
    const oc = await seedComment({
      eventId: old.id,
      authorMemberId: author.id,
    });
    const r = await toggleCommentVote({ commentId: oc.id, voted: true });
    expect(r).toEqual({ error: "commentsClosed" });
  });

  it("vote calls neither updateTag nor cookies().set", async () => {
    const ev = await mkEvent();
    const author = await newMember();
    const c = await seedComment({ eventId: ev.id, authorMemberId: author.id });
    asMember(await newMember());
    await toggleCommentVote({ commentId: c.id, voted: true });
    await toggleCommentVote({ commentId: c.id, voted: false });
    expect(mocks.updateTag).not.toHaveBeenCalled();
    expect(mocks.cookies.size).toBe(0);
  });
});

describe("pin, lock, approve", () => {
  it("pinning a second root unpins the first in the same channel only", async () => {
    const ev = await mkEvent();
    const m = await newMember();
    const a = await seedComment({
      eventId: ev.id,
      authorMemberId: m.id,
      pinned: true,
    });
    const g = await seedComment({
      eventId: ev.id,
      authorMemberId: m.id,
      channel: "group",
      pinned: true,
    });
    const b = await seedComment({ eventId: ev.id, authorMemberId: m.id });
    asMember(host);
    const r = await pinComment({ commentId: b.id, pinned: true });
    expect(r).toEqual({ success: true });
    expect((await rowOf(a.id)).pinned).toBe(false);
    expect((await rowOf(b.id)).pinned).toBe(true);
    expect((await rowOf(g.id)).pinned).toBe(true);
    expect(mocks.updateTag).toHaveBeenCalledWith(`xcmt:e${ev.id}`);
  });

  it("cannot pin a reply", async () => {
    const ev = await mkEvent();
    const m = await newMember();
    const root = await seedComment({ eventId: ev.id, authorMemberId: m.id });
    const reply = await seedComment({
      eventId: ev.id,
      authorMemberId: m.id,
      parentId: root.id,
    });
    asMember(host);
    const r = await pinComment({ commentId: reply.id, pinned: true });
    expect("error" in r).toBe(true);
    expect((await rowOf(reply.id)).pinned).toBe(false);
  });

  it("non-host cannot pin, lock or approve, also with an extra actor field", async () => {
    const ev = await mkEvent();
    const m = await newMember();
    const c = await seedComment({ eventId: ev.id, authorMemberId: m.id });
    const h = await seedComment({
      eventId: ev.id,
      authorMemberId: m.id,
      status: "held",
    });
    asMember(m);
    const pin = await pinComment({
      commentId: c.id,
      pinned: true,
      actorId: host.id,
    });
    const lock = await setCommentsLocked({
      eventId: ev.id,
      locked: true,
      actorId: host.id,
    });
    const appr = await approveHeldComment({
      commentId: h.id,
      actorId: host.id,
    });
    expect("error" in pin).toBe(true);
    expect("error" in lock).toBe(true);
    expect("error" in appr).toBe(true);
    expect((await rowOf(c.id)).pinned).toBe(false);
    expect((await rowOf(h.id)).status).toBe("held");
    const [e] = await testDb
      .select()
      .from(exchangeEvents)
      .where(eq(exchangeEvents.id, ev.id));
    expect(e.commentsLocked).toBe(false);
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });

  it("approve turns held into visible and notifies the host for a root question", async () => {
    await enableNotificationsForTest(testDb);
    const ev = await mkEvent();
    const m = await newMember();
    const h = await seedComment({
      eventId: ev.id,
      authorMemberId: m.id,
      status: "held",
    });
    asMember(host);
    const r = await approveHeldComment({ commentId: h.id });
    expect(r).toEqual({ success: true });
    expect((await rowOf(h.id)).status).toBe("visible");
    const ns = await testDb.select().from(notifications);
    expect(
      ns.some(
        (n) => n.recipientId === host.id && n.kind === "exchange_comment_new",
      ),
    ).toBe(true);
    expect(mocks.updateTag).toHaveBeenCalledWith(`xcmt:e${ev.id}`);
    expect("error" in (await approveHeldComment({ commentId: h.id }))).toBe(
      true,
    );
  });

  it("lock blocks addComment but allows delete", async () => {
    const ev = await mkEvent();
    const m = await newMember();
    const c = await seedComment({ eventId: ev.id, authorMemberId: m.id });
    asMember(host);
    expect(await setCommentsLocked({ eventId: ev.id, locked: true })).toEqual({
      success: true,
    });
    expect(mocks.updateTag).toHaveBeenCalledWith(`xcmt:e${ev.id}`);
    expect(mocks.updateTag).toHaveBeenCalledWith(`xcmeta:${ev.publicCode}`);
    asMember(m);
    tick();
    const r = await post(ev.publicCode);
    expect(r).toEqual({ error: "commentsLocked" });
    expect(await deleteComment({ commentId: c.id })).toEqual({
      success: true,
    });
  });
});

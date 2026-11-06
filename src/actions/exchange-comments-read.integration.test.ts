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
import { and, eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import {
  exchangeCommentReads,
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

// Data Cache giả: lưu theo keyParts, serialize JSON như Next, và updateTag(tag)
// xoá mọi mục mang tag đó. Wrapper dựng lại mỗi lần gọi nên chỉ key quyết định.
const mocks = vi.hoisted(() => {
  const store = new Map<string, { json: string; tags: string[] }>();
  return {
    store,
    flag: vi.fn(),
    auth: vi.fn(),
    verify: vi.fn(),
    cookies: new Map<string, string>(),
    updateTag: vi.fn((tag: string) => {
      for (const [k, v] of store) if (v.tags.includes(tag)) store.delete(k);
    }),
  };
});
vi.mock("@/lib/exchange-flag", () => ({ isExchangeEnabled: mocks.flag }));
vi.mock("@/lib/member-auth", () => ({
  requireExchangeMember: mocks.auth,
  // Cùng nguồn với requireExchangeMember: khách là { error }.
  getExchangeViewer: async () => {
    const a = await mocks.auth();
    return a && "member" in a
      ? { status: "ok", user: a.user, member: a.member, isGroupMember: true }
      : { status: "anonymous" };
  },
}));
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
  unstable_cache:
    <R>(fn: () => Promise<R>, keyParts: string[], opts: { tags?: string[] }) =>
    async (): Promise<R> => {
      const key = JSON.stringify(keyParts);
      const hit = mocks.store.get(key);
      if (hit) return JSON.parse(hit.json) as R;
      const out = await fn();
      mocks.store.set(key, {
        json: JSON.stringify(out ?? null),
        tags: opts?.tags ?? [],
      });
      return JSON.parse(JSON.stringify(out ?? null)) as R;
    },
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const {
  addComment,
  editComment,
  deleteComment,
  toggleCommentVote,
  listExchangeComments,
  listCommentReplies,
  markCommentsRead,
} = await import("./exchange-comments");
const { sealCommentPass, COMMENT_PASS_COOKIE } =
  await import("@/lib/exchange/comment-pass");

type Member = typeof members.$inferSelect;
type Page = Extract<
  Awaited<ReturnType<typeof listExchangeComments>>,
  { success: true }
>["data"];
type View = Page["roots"][number];

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
  .values({
    name: "Host",
    approvalStatus: "approved",
    email: "host@fwbb.test",
    phoneNumber: "0900000999",
  })
  .returning();

let seq = 0;
async function newMember(
  over: Partial<typeof members.$inferInsert> = {},
): Promise<Member> {
  seq += 1;
  const [m] = await testDb
    .insert(members)
    .values({
      name: `M${seq}`,
      approvalStatus: "approved",
      email: `m${seq}@fwbb.test`,
      phoneNumber: `09000001${String(seq).padStart(2, "0")}`,
      ...over,
    })
    .returning();
  return m;
}
const asMember = (m: Member) =>
  mocks.auth.mockResolvedValue({
    user: { memberId: m.id, externalId: "x" },
    member: m,
  });
const asGuest = () => mocks.auth.mockResolvedValue({ error: "anon" });

let codeSeq = 0;
async function mkEvent(over: Partial<typeof exchangeEvents.$inferInsert> = {}) {
  codeSeq += 1;
  const [ev] = await testDb
    .insert(exchangeEvents)
    .values({
      publicCode: `cr${codeSeq}`,
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

async function list(
  code: string,
  over: Partial<{
    channel: "qa" | "group";
    sort: "top" | "new";
    offset: number;
  }> = {},
): Promise<Page> {
  const r = await listExchangeComments({
    code,
    channel: "qa",
    sort: "top",
    offset: 0,
    ...over,
  });
  if (!("success" in r)) throw new Error(`list failed: ${JSON.stringify(r)}`);
  return r.data;
}

const countRows = (views: View[]): number =>
  views.reduce((n, v) => n + 1 + countRows(v.replies), 0);

const cachedEntries = () =>
  [...mocks.store.entries()]
    .filter(([k]) => JSON.parse(k)[0] === "xcmt")
    .map(([k, v]) => ({ keyParts: JSON.parse(k), tags: v.tags, json: v.json }));

beforeEach(async () => {
  await testDb.delete(notifications);
  await testDb.delete(exchangeCommentReads);
  await testDb.delete(exchangeCommentVotes);
  await testDb.delete(exchangeComments);
  await testDb.delete(exchangeRegistrations);
  await testDb.delete(hostBlocks);
  await testDb.delete(exchangeEvents);
  await testDb.delete(rateLimitBuckets);
  mocks.store.clear();
  mocks.cookies.clear();
  mocks.flag.mockReset().mockResolvedValue(true);
  mocks.verify.mockReset().mockResolvedValue({ ok: true });
  mocks.auth.mockReset();
  mocks.updateTag.mockClear();
  vi.stubEnv("USER_COOKIE_SECRET", "test-user-cookie-secret-at-least-16-chars");
  clock = Date.now();
  vi.setSystemTime(clock);
});

describe("listExchangeComments: guests and the public cache", () => {
  it("guest gets qa only and the group channel returns commentNotFound", async () => {
    const ev = await mkEvent();
    const m1 = await newMember();
    await addReg(ev.id, m1.id);
    await seedComment({ eventId: ev.id, authorMemberId: m1.id, body: "hi" });
    await seedComment({
      eventId: ev.id,
      authorMemberId: host.id,
      channel: "group",
      body: "group only",
    });

    asGuest();
    const page = await list(ev.publicCode);
    expect(page.roots.map((r) => r.body)).toEqual(["hi"]);
    expect(page.role).toBe("guest");
    expect(page.canRead).toEqual({ qa: true, group: false });
    expect(page.canWrite).toBe(false);
    expect(page.needsCaptcha).toBe(false);
    expect(page.unread).toBe(false);
    expect(page.total).toBe(1);
    expect(
      await listExchangeComments({
        code: ev.publicCode,
        channel: "group",
        sort: "top",
        offset: 0,
      }),
    ).toEqual({ error: "commentNotFound" });
  });

  it("guest listing twice runs DB queries only on the first call", async () => {
    const ev = await mkEvent();
    const m1 = await newMember();
    await seedComment({ eventId: ev.id, authorMemberId: m1.id });
    asGuest();
    const exec = vi.spyOn(client, "execute");
    try {
      await list(ev.publicCode);
      expect(exec).toHaveBeenCalled();
      exec.mockClear();
      const again = await list(ev.publicCode);
      expect(exec).not.toHaveBeenCalled();
      expect(again.roots).toHaveLength(1);
    } finally {
      exec.mockRestore();
    }
  });

  it("the cached qa payload has null body and author for held, deleted and hidden rows and never contains a group comment", async () => {
    const ev = await mkEvent();
    const m1 = await newMember();
    const m2 = await newMember();
    await addReg(ev.id, m1.id);
    const ok = await seedComment({ eventId: ev.id, authorMemberId: m1.id });
    const states = ["held", "deleted", "hidden"] as const;
    for (const status of states) {
      const root = await seedComment({
        eventId: ev.id,
        authorMemberId: m1.id,
        status,
        body: `secret ${status} 0912345678`,
      });
      await seedComment({
        eventId: ev.id,
        authorMemberId: m2.id,
        parentId: root.id,
        replyToMemberId: m1.id,
        body: "reply",
      });
    }
    await seedComment({
      eventId: ev.id,
      authorMemberId: m1.id,
      parentId: ok.id,
      replyToMemberId: m1.id,
      status: "held",
      body: "secret held reply",
    });
    await seedComment({
      eventId: ev.id,
      authorMemberId: host.id,
      channel: "group",
      body: "secret group",
    });

    asGuest();
    await list(ev.publicCode, { sort: "new" });
    const entries = cachedEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].keyParts).toEqual([
      "xcmt",
      String(ev.id),
      "qa",
      "new",
      "0",
    ]);
    expect(entries[0].tags).toEqual([`xcmt:e${ev.id}`]);
    expect(entries[0].json).not.toContain("secret");
    const stored = JSON.parse(entries[0].json) as {
      rows: Record<string, unknown>[];
    };
    const masked = stored.rows.filter((r) =>
      ["held", "deleted", "hidden"].includes(r.status as string),
    );
    expect(masked).toHaveLength(4);
    for (const r of masked) {
      expect(r.body).toBeNull();
      expect(r.authorMemberId).toBeNull();
      expect(r.authorName).toBeNull();
      expect(r.authorAvatarUrl).toBeNull();
      expect(r.authorAvatarKey).toBeNull();
    }
    expect(stored.rows.every((r) => r.channel === "qa")).toBe(true);

    // Kênh Nhóm buổi không bao giờ đi qua cache, kể cả với host.
    asMember(host);
    await list(ev.publicCode, { channel: "group", sort: "new" });
    expect(cachedEntries()).toHaveLength(1);
  });

  it("without updateTag a second read returns the cached page; after deleteComment it shows the placeholder", async () => {
    const ev = await mkEvent();
    const m1 = await newMember();
    const m2 = await newMember();
    const root = await seedComment({
      eventId: ev.id,
      authorMemberId: m1.id,
      body: "first",
    });
    await seedComment({
      eventId: ev.id,
      authorMemberId: m2.id,
      parentId: root.id,
      replyToMemberId: m1.id,
      body: "reply",
    });

    asGuest();
    expect((await list(ev.publicCode)).roots[0].body).toBe("first");
    await testDb
      .update(exchangeComments)
      .set({ body: "changed behind the cache" })
      .where(eq(exchangeComments.id, root.id));
    expect((await list(ev.publicCode)).roots[0].body).toBe("first");

    asMember(m1);
    expect(await deleteComment({ commentId: root.id })).toEqual({
      success: true,
    });
    expect(mocks.updateTag).toHaveBeenCalledWith(`xcmt:e${ev.id}`);

    asGuest();
    const after = await list(ev.publicCode);
    expect(after.roots).toHaveLength(1);
    expect(after.roots[0]).toMatchObject({
      state: "deleted",
      body: null,
      author: null,
    });
    expect(after.roots[0].replies.map((r) => r.body)).toEqual(["reply"]);
  });

  it('posting never calls updateTag("exchange")', async () => {
    const ev = await mkEvent();
    const m1 = await newMember();
    asMember(m1);
    const r = await post(ev.publicCode);
    expect("success" in r).toBe(true);
    expect(mocks.updateTag).toHaveBeenCalledWith(`xcmt:e${ev.id}`);
    expect(mocks.updateTag).not.toHaveBeenCalledWith("exchange");
  });
});

describe("listExchangeComments: held comments", () => {
  it("held reply under the 15th root shows on page 2 to the host and its author, as a placeholder or not at all to others", async () => {
    const ev = await mkEvent();
    const m1 = await newMember();
    const author = await newMember();
    const other = await newMember();
    const roots = [];
    for (let i = 0; i < 15; i++) {
      roots.push(
        await seedComment({
          eventId: ev.id,
          authorMemberId: m1.id,
          body: `root ${i + 1}`,
          createdAt: iso(i * 1000),
        }),
      );
    }
    await seedComment({
      eventId: ev.id,
      authorMemberId: author.id,
      parentId: roots[14].id,
      replyToMemberId: m1.id,
      status: "held",
      body: "goi 0912345678 nhe",
      createdAt: iso(20_000),
    });

    asGuest();
    const first = await list(ev.publicCode);
    expect(first.roots).toHaveLength(10);
    expect(first.hasMore).toBe(true);
    expect(first.nextOffset).toBe(10);
    const guestPage2 = await list(ev.publicCode, { offset: 10 });
    expect(guestPage2.roots.map((r) => r.body)).toEqual([
      "root 11",
      "root 12",
      "root 13",
      "root 14",
      "root 15",
    ]);
    expect(guestPage2.hasMore).toBe(false);
    expect(guestPage2.nextOffset).toBeNull();
    expect(guestPage2.roots[4].replies).toEqual([]);
    expect(JSON.stringify(guestPage2)).not.toContain("0912345678");

    asMember(other);
    const otherPage = await list(ev.publicCode, { offset: 10 });
    expect(otherPage.roots[4].replies).toEqual([]);
    expect(JSON.stringify(otherPage)).not.toContain("0912345678");

    asMember(author);
    const mine = (await list(ev.publicCode, { offset: 10 })).roots[4];
    expect(mine.replies).toHaveLength(1);
    expect(mine.replies[0]).toMatchObject({
      body: "goi 0912345678 nhe",
      state: "held",
      mine: true,
      canApprove: false,
    });
    expect(mine.replies[0].author?.name).toBe(author.name);

    asMember(host);
    const hostView = (await list(ev.publicCode, { offset: 10 })).roots[4];
    expect(hostView.replies[0]).toMatchObject({
      body: "goi 0912345678 nhe",
      state: "held",
      canApprove: true,
    });
  });

  it("host gets the held queue at offset 0", async () => {
    const ev = await mkEvent();
    const m1 = await newMember();
    const m2 = await newMember();
    const root = await seedComment({ eventId: ev.id, authorMemberId: m1.id });
    await seedComment({
      eventId: ev.id,
      authorMemberId: m2.id,
      parentId: root.id,
      replyToMemberId: m1.id,
      status: "held",
      body: "held reply",
      createdAt: iso(1000),
    });
    await seedComment({
      eventId: ev.id,
      authorMemberId: m2.id,
      status: "held",
      body: "held root",
      createdAt: iso(2000),
    });

    asMember(host);
    const page = await list(ev.publicCode);
    expect(page.hostHeld.map((v) => v.body)).toEqual([
      "held root",
      "held reply",
    ]);
    expect(page.hostHeld[1].parentId).toBe(root.id);
    expect(page.hostHeld.every((v) => v.canApprove && v.state === "held")).toBe(
      true,
    );
    expect((await list(ev.publicCode, { offset: 10 })).hostHeld).toEqual([]);

    asMember(m2);
    expect((await list(ev.publicCode)).hostHeld).toEqual([]);
    asGuest();
    expect((await list(ev.publicCode)).hostHeld).toEqual([]);
  });

  it("edited-to-held root keeps its replies visible to everyone", async () => {
    const ev = await mkEvent();
    const m1 = await newMember();
    const m2 = await newMember();
    const other = await newMember();
    asMember(m1);
    const root = await post(ev.publicCode, { body: "ai di khong" });
    if (!("success" in root)) throw new Error("post failed");
    tick();
    asMember(m2);
    const reply = await post(ev.publicCode, {
      body: "minh di",
      parentId: root.data.id,
    });
    expect("success" in reply).toBe(true);
    tick();
    asMember(m1);
    expect(
      await editComment({ commentId: root.data.id, body: "goi 0912345678" }),
    ).toEqual({ success: true });

    for (const who of [null, other, m2] as const) {
      if (who) asMember(who);
      else asGuest();
      const page = await list(ev.publicCode);
      expect(page.roots).toHaveLength(1);
      expect(page.roots[0]).toMatchObject({
        state: "held",
        body: null,
        author: null,
      });
      expect(page.roots[0].replies.map((r) => r.body)).toEqual(["minh di"]);
    }
    asMember(m1);
    const own = await list(ev.publicCode);
    expect(own.roots[0]).toMatchObject({
      body: "goi 0912345678",
      state: "held",
      mine: true,
    });
    expect(own.roots[0].replies.map((r) => r.body)).toEqual(["minh di"]);
  });
});

describe("listExchangeComments: paging, replies and sort", () => {
  it("a page never returns more than 50 comment rows; moreReplies counts the rest; listCommentReplies returns them", async () => {
    const ev = await mkEvent();
    const m1 = await newMember();
    const m2 = await newMember();
    let t = 0;
    const firstRoot: { id: number; tier1: number[] } = { id: 0, tier1: [] };
    for (let i = 0; i < 12; i++) {
      const root = await seedComment({
        eventId: ev.id,
        authorMemberId: m1.id,
        body: `root ${i}`,
        createdAt: iso((t += 1000)),
      });
      const tier1 = await testDb
        .insert(exchangeComments)
        .values(
          [0, 1, 2, 3].map((j) => ({
            eventId: ev.id,
            channel: "qa" as const,
            parentId: root.id,
            replyToMemberId: m1.id,
            authorMemberId: m2.id,
            body: `r${i}.${j}`,
            createdAt: iso((t += 1000)),
          })),
        )
        .returning({ id: exchangeComments.id });
      await testDb.insert(exchangeComments).values(
        tier1.flatMap((p, j) =>
          [0, 1, 2].map((k) => ({
            eventId: ev.id,
            channel: "qa" as const,
            parentId: p.id,
            replyToMemberId: m2.id,
            authorMemberId: m1.id,
            body: `r${i}.${j}.${k}`,
            createdAt: iso((t += 1000)),
          })),
        ),
      );
      if (i === 0) {
        firstRoot.id = root.id;
        firstRoot.tier1 = tier1.map((x) => x.id);
      }
    }

    asGuest();
    const page = await list(ev.publicCode);
    expect(page.roots).toHaveLength(10);
    expect(countRows(page.roots)).toBe(50);
    expect(page.total).toBe(12 * (1 + 4 + 12));
    const r0 = page.roots[0];
    expect(r0.body).toBe("root 0");
    expect(r0.replies.map((r) => r.body)).toEqual(["r0.0", "r0.1"]);
    expect(r0.moreReplies).toBe(2);
    expect(r0.replies[0].replies.map((r) => r.body)).toEqual(["r0.0.0"]);
    expect(r0.replies[0].moreReplies).toBe(2);

    const more = await listCommentReplies({
      commentId: firstRoot.id,
      offset: 0,
    });
    if (!("success" in more)) throw new Error("replies failed");
    expect(more.data.replies.map((r) => r.body)).toEqual([
      "r0.0",
      "r0.1",
      "r0.2",
      "r0.3",
    ]);
    expect(more.data.replies[3].replies.map((r) => r.body)).toEqual([
      "r0.3.0",
      "r0.3.1",
      "r0.3.2",
    ]);
    expect(more.data.replies[3].moreReplies).toBe(0);
    expect(more.data.hasMore).toBe(false);
    expect(countRows(more.data.replies)).toBeLessThanOrEqual(50);

    const tier2 = await listCommentReplies({
      commentId: firstRoot.tier1[1],
      offset: 0,
    });
    if (!("success" in tier2)) throw new Error("tier2 failed");
    expect(tier2.data.replies.map((r) => r.body)).toEqual([
      "r0.1.0",
      "r0.1.1",
      "r0.1.2",
    ]);

    // Gốc nhiều trả lời: mỗi lần tối đa 10 tầng 1, có trang sau.
    const big = await seedComment({ eventId: ev.id, authorMemberId: m1.id });
    await testDb.insert(exchangeComments).values(
      Array.from({ length: 12 }, (_, j) => ({
        eventId: ev.id,
        channel: "qa" as const,
        parentId: big.id,
        replyToMemberId: m1.id,
        authorMemberId: m2.id,
        body: `b${j}`,
        createdAt: iso((t += 1000)),
      })),
    );
    const p1 = await listCommentReplies({ commentId: big.id, offset: 0 });
    if (!("success" in p1)) throw new Error("p1 failed");
    expect(p1.data.replies).toHaveLength(10);
    expect(p1.data.hasMore).toBe(true);
    expect(p1.data.nextOffset).toBe(10);
    const p2 = await listCommentReplies({ commentId: big.id, offset: 10 });
    if (!("success" in p2)) throw new Error("p2 failed");
    expect(p2.data.replies.map((r) => r.body)).toEqual(["b10", "b11"]);
    expect(p2.data.hasMore).toBe(false);
  });

  it("listCommentReplies on someone else's held root returns commentNotFound", async () => {
    const ev = await mkEvent();
    const m2 = await newMember();
    const other = await newMember();
    const held = await seedComment({
      eventId: ev.id,
      authorMemberId: m2.id,
      status: "held",
      body: "held",
    });
    await seedComment({
      eventId: ev.id,
      authorMemberId: host.id,
      parentId: held.id,
      replyToMemberId: m2.id,
      body: "host reply",
    });
    asMember(other);
    expect(await listCommentReplies({ commentId: held.id, offset: 0 })).toEqual(
      { error: "commentNotFound" },
    );
    asGuest();
    expect(await listCommentReplies({ commentId: held.id, offset: 0 })).toEqual(
      { error: "commentNotFound" },
    );
    asMember(m2);
    const own = await listCommentReplies({ commentId: held.id, offset: 0 });
    if (!("success" in own)) throw new Error("own failed");
    expect(own.data.replies.map((r) => r.body)).toEqual(["host reply"]);
  });

  it("top and new sort; pinned first in both", async () => {
    const ev = await mkEvent();
    const m1 = await newMember();
    await seedComment({
      eventId: ev.id,
      authorMemberId: m1.id,
      body: "pinned",
      pinned: true,
      createdAt: iso(500),
    });
    await seedComment({
      eventId: ev.id,
      authorMemberId: m1.id,
      body: "a",
      createdAt: iso(1000),
    });
    await seedComment({
      eventId: ev.id,
      authorMemberId: m1.id,
      body: "b",
      upvotes: 5,
      createdAt: iso(2000),
    });
    await seedComment({
      eventId: ev.id,
      authorMemberId: m1.id,
      body: "c",
      upvotes: 1,
      createdAt: iso(3000),
    });
    asGuest();
    expect(
      (await list(ev.publicCode, { sort: "top" })).roots.map((r) => r.body),
    ).toEqual(["pinned", "b", "c", "a"]);
    expect(
      (await list(ev.publicCode, { sort: "new" })).roots.map((r) => r.body),
    ).toEqual(["pinned", "c", "b", "a"]);
  });

  it("a voter sees the fresh upvote count while guests may see the cached one", async () => {
    const ev = await mkEvent();
    const m1 = await newMember();
    const voter = await newMember();
    const root = await seedComment({ eventId: ev.id, authorMemberId: m1.id });
    asGuest();
    expect((await list(ev.publicCode)).roots[0].upvotes).toBe(0);

    asMember(voter);
    expect(
      await toggleCommentVote({ commentId: root.id, voted: true }),
    ).toEqual({ success: true, data: { upvotes: 1 } });
    expect(mocks.updateTag).not.toHaveBeenCalled();
    const mine = (await list(ev.publicCode)).roots[0];
    expect(mine.upvotes).toBe(1);
    expect(mine.myVote).toBe(true);

    asGuest();
    expect((await list(ev.publicCode)).roots[0].upvotes).toBe(0);
  });
});

describe("listExchangeComments: privacy and viewer fields", () => {
  it("payload has no member id, phone or email", async () => {
    const ev = await mkEvent();
    const m1 = await newMember();
    const m2 = await newMember();
    await addReg(ev.id, m1.id);
    const root = await seedComment({ eventId: ev.id, authorMemberId: m1.id });
    await seedComment({
      eventId: ev.id,
      authorMemberId: m2.id,
      parentId: root.id,
      replyToMemberId: host.id,
      body: "reply to host",
    });
    await seedComment({
      eventId: ev.id,
      authorMemberId: m2.id,
      status: "held",
      body: "held",
    });
    await seedComment({
      eventId: ev.id,
      authorMemberId: m1.id,
      channel: "group",
      body: "group",
    });

    const keys = new Set<string>();
    const walk = (x: unknown) => {
      if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === "object") {
        for (const [k, v] of Object.entries(x)) {
          keys.add(k);
          walk(v);
        }
      }
    };
    const payloads: unknown[] = [];
    asMember(host);
    payloads.push(
      await listExchangeComments({
        code: ev.publicCode,
        channel: "qa",
        sort: "top",
        offset: 0,
      }),
    );
    payloads.push(
      await listExchangeComments({
        code: ev.publicCode,
        channel: "group",
        sort: "new",
        offset: 0,
      }),
    );
    payloads.push(await listCommentReplies({ commentId: root.id, offset: 0 }));
    asMember(m1);
    payloads.push(
      await listExchangeComments({
        code: ev.publicCode,
        channel: "qa",
        sort: "top",
        offset: 0,
      }),
    );
    asGuest();
    payloads.push(
      await listExchangeComments({
        code: ev.publicCode,
        channel: "qa",
        sort: "top",
        offset: 0,
      }),
    );

    for (const p of payloads) {
      expect("success" in (p as object)).toBe(true);
      walk(p);
      const json = JSON.stringify(p);
      for (const m of [host, m1, m2]) {
        expect(json).not.toContain(m.email as string);
        expect(json).not.toContain(m.phoneNumber as string);
      }
    }
    for (const k of keys) expect(k).not.toMatch(/member|email|phone|event/i);
    // Chip @tên vẫn dựng được mà không cần id.
    const hostPage = payloads[0] as { data: Page };
    expect(
      hostPage.data.roots.find((r) => r.id === root.id)?.replies[0].replyToName,
    ).toBe("Host");
  });

  it("needsCaptcha follows the pass cookie and is false for guests", async () => {
    const ev = await mkEvent();
    const m1 = await newMember();
    asGuest();
    expect((await list(ev.publicCode)).needsCaptcha).toBe(false);
    asMember(m1);
    expect((await list(ev.publicCode)).needsCaptcha).toBe(true);
    mocks.cookies.set(COMMENT_PASS_COOKIE, sealCommentPass(m1.id, new Date()));
    expect((await list(ev.publicCode)).needsCaptcha).toBe(false);
  });
});

describe("unread and markCommentsRead", () => {
  it("unread is false for a pending registrant when only the group channel has new comments", async () => {
    const ev = await mkEvent();
    const pending = await newMember();
    await addReg(ev.id, pending.id, "pending");
    await seedComment({
      eventId: ev.id,
      authorMemberId: host.id,
      channel: "group",
      body: "group news",
    });
    asMember(pending);
    const page = await list(ev.publicCode);
    expect(page.canRead).toEqual({ qa: true, group: false });
    expect(page.unread).toBe(false);
    expect(
      await listExchangeComments({
        code: ev.publicCode,
        channel: "group",
        sort: "top",
        offset: 0,
      }),
    ).toEqual({ error: "commentNotFound" });
  });

  it("unread true only for the channel with newer comments by others", async () => {
    const ev = await mkEvent();
    const m1 = await newMember();
    const m2 = await newMember();
    const stranger = await newMember();
    await addReg(ev.id, m1.id);
    await seedComment({ eventId: ev.id, authorMemberId: m2.id });
    await seedComment({
      eventId: ev.id,
      authorMemberId: m1.id,
      channel: "group",
      body: "my own",
    });

    asMember(m1);
    expect((await list(ev.publicCode)).unread).toBe(true);
    expect((await list(ev.publicCode, { channel: "group" })).unread).toBe(
      false,
    );

    asMember(stranger);
    expect((await list(ev.publicCode)).unread).toBe(false);
    asMember(host);
    expect((await list(ev.publicCode)).unread).toBe(true);
    expect((await list(ev.publicCode, { channel: "group" })).unread).toBe(true);

    asMember(m1);
    tick();
    expect(
      await markCommentsRead({
        code: ev.publicCode,
        channel: "qa",
        upTo: new Date().toISOString(),
      }),
    ).toEqual({ success: true });
    expect((await list(ev.publicCode)).unread).toBe(false);

    tick();
    await seedComment({
      eventId: ev.id,
      authorMemberId: host.id,
      channel: "group",
      body: "host news",
      createdAt: iso(0),
    });
    expect((await list(ev.publicCode, { channel: "group" })).unread).toBe(true);
    expect((await list(ev.publicCode)).unread).toBe(false);
  });

  it("markCommentsRead stores min(upTo, now) per channel and never moves back", async () => {
    const ev = await mkEvent();
    const m1 = await newMember();
    await addReg(ev.id, m1.id);
    asMember(m1);
    const readRow = async () =>
      (
        await testDb
          .select()
          .from(exchangeCommentReads)
          .where(
            and(
              eq(exchangeCommentReads.eventId, ev.id),
              eq(exchangeCommentReads.memberId, m1.id),
            ),
          )
      )[0];

    const nowIso = iso(0);
    await markCommentsRead({
      code: ev.publicCode,
      channel: "qa",
      upTo: iso(DAY),
    });
    expect((await readRow()).lastReadAt).toBe(nowIso);
    expect((await readRow()).lastReadGroupAt).toBeNull();

    await markCommentsRead({
      code: ev.publicCode,
      channel: "qa",
      upTo: iso(-60_000),
    });
    expect((await readRow()).lastReadAt).toBe(nowIso);

    const earlier = iso(-5_000);
    await markCommentsRead({
      code: ev.publicCode,
      channel: "group",
      upTo: earlier,
    });
    expect(await readRow()).toMatchObject({
      lastReadAt: nowIso,
      lastReadGroupAt: earlier,
    });
    expect(await testDb.select().from(exchangeCommentReads)).toHaveLength(1);
    expect(mocks.updateTag).not.toHaveBeenCalled();
    expect(mocks.cookies.size).toBe(0);
  });

  it("markCommentsRead by a stranger writes nothing", async () => {
    const ev = await mkEvent();
    const stranger = await newMember();
    const pending = await newMember();
    await addReg(ev.id, pending.id, "pending");

    asMember(stranger);
    expect(
      await markCommentsRead({
        code: ev.publicCode,
        channel: "qa",
        upTo: iso(0),
      }),
    ).toEqual({ success: true });
    asMember(pending);
    expect(
      await markCommentsRead({
        code: ev.publicCode,
        channel: "group",
        upTo: iso(0),
      }),
    ).toEqual({ success: true });
    expect(await testDb.select().from(exchangeCommentReads)).toEqual([]);

    asGuest();
    expect(
      "error" in
        (await markCommentsRead({
          code: ev.publicCode,
          channel: "qa",
          upTo: iso(0),
        })),
    ).toBe(true);
    expect(await testDb.select().from(exchangeCommentReads)).toEqual([]);
  });
});

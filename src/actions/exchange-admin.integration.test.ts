import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  abuseReports,
  exchangeCommentReads,
  exchangeCommentVotes,
  exchangeComments,
  exchangeEvents,
  exchangeRegistrations,
  members,
  notifications,
  venueReviews,
  venues,
} from "@/db/schema";
import { eq } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  flag: vi.fn(),
  admin: vi.fn(),
  updateTag: vi.fn(),
}));
vi.mock("@/lib/exchange-flag", () => ({ isExchangeEnabled: mocks.flag }));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.admin }));
vi.mock("next/cache", () => ({
  updateTag: mocks.updateTag,
  revalidatePath: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

const { db: testDb } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const {
  adminListExchanges,
  adminSetExchangeHidden,
  adminCancelExchange,
  adminListReports,
  adminResolveReport,
  adminListComments,
  adminModerateComment,
} = await import("./exchange-admin");
const { enableNotificationsForTest } =
  await import("@/lib/notifications/test-helpers");

const DAY = 86_400_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const [venue] = await testDb
  .insert(venues)
  .values({ name: "San Z", lat: 10, lng: 106, status: "approved" })
  .returning();
const [host] = await testDb
  .insert(members)
  .values({
    name: "Host A",
    approvalStatus: "approved",
    phoneNumber: "0900000001",
    email: "host@example.com",
  })
  .returning();
const [guest] = await testDb
  .insert(members)
  .values({ name: "Guest B", approvalStatus: "approved" })
  .returning();

let seq = 0;
async function mkEvent(over: Partial<typeof exchangeEvents.$inferInsert> = {}) {
  seq += 1;
  const [ev] = await testDb
    .insert(exchangeEvents)
    .values({
      publicCode: `adm${seq}`,
      hostMemberId: host.id,
      venueId: venue.id,
      title: `Buoi ${seq}`,
      startAt: iso(5 * DAY),
      endAt: iso(5 * DAY + 2 * 3_600_000),
      slotsTotal: 4,
      feeMode: "fixed",
      feeAmountMale: 50000,
      registerDeadline: iso(4 * DAY),
      cancelDeadline: iso(3 * DAY),
      status: "open",
      createdAt: iso(0),
      updatedAt: iso(0),
      ...over,
    })
    .returning();
  return ev;
}
async function addReg(eventId: number) {
  await testDb.insert(exchangeRegistrations).values({
    eventId,
    memberId: guest.id,
    status: "approved",
    maleCount: 1,
    femaleCount: 0,
    createdAt: iso(0),
    updatedAt: iso(0),
  });
}
const noticesOf = (kind: string) =>
  testDb.select().from(notifications).where(eq(notifications.kind, kind));

beforeEach(async () => {
  await testDb.delete(notifications);
  await testDb.delete(abuseReports);
  await testDb.delete(venueReviews);
  await testDb.delete(exchangeRegistrations);
  await testDb.delete(exchangeCommentVotes);
  await testDb.delete(exchangeCommentReads);
  await testDb.delete(exchangeComments);
  await testDb.delete(exchangeEvents);
  await enableNotificationsForTest(testDb);
  mocks.flag.mockReset().mockResolvedValue(true);
  mocks.admin.mockReset().mockResolvedValue({ admin: { sub: "1" } });
  mocks.updateTag.mockClear();
});

describe("exchange admin actions", () => {
  it("admin actions refuse a member cookie", async () => {
    const ev = await mkEvent();
    mocks.admin.mockResolvedValue({ error: "Không có quyền admin" });
    expect(await adminListExchanges("all")).toEqual({
      error: "Không có quyền admin",
    });
    expect(
      await adminSetExchangeHidden({ eventId: ev.id, hidden: true }),
    ).toHaveProperty("error");
    expect(await adminCancelExchange({ eventId: ev.id })).toHaveProperty(
      "error",
    );
    expect(await adminListReports("open")).toHaveProperty("error");
    expect(
      await adminResolveReport({ reportId: 1, status: "resolved" }),
    ).toHaveProperty("error");
    const [row] = await testDb
      .select()
      .from(exchangeEvents)
      .where(eq(exchangeEvents.id, ev.id));
    expect(row.hiddenAt).toBeNull();
    expect(row.status).toBe("open");
  });

  it("refuses everything when the flag is off", async () => {
    const ev = await mkEvent();
    mocks.flag.mockResolvedValue(false);
    expect(await adminListExchanges("all")).toEqual({ error: "notFound" });
    expect(
      await adminSetExchangeHidden({ eventId: ev.id, hidden: true }),
    ).toEqual({ error: "notFound" });
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("lists events without host contact data", async () => {
    const ev = await mkEvent();
    await addReg(ev.id);
    await mkEvent({ hiddenAt: iso(-1000) });
    const all = await adminListExchanges("all");
    if ("error" in all) throw new Error(all.error);
    expect(all.data).toHaveLength(2);
    const row = all.data.find((r) => r.id === ev.id)!;
    expect(row).toMatchObject({
      hostName: "Host A",
      venueName: "San Z",
      publicCode: ev.publicCode,
      holdingHeads: 1,
    });
    expect(JSON.stringify(all.data)).not.toContain("0900000001");
    expect(JSON.stringify(all.data)).not.toContain("host@example.com");
    const hidden = await adminListExchanges("hidden");
    if ("error" in hidden) throw new Error(hidden.error);
    expect(hidden.data).toHaveLength(1);
    const upcoming = await adminListExchanges("upcoming");
    if ("error" in upcoming) throw new Error(upcoming.error);
    expect(upcoming.data.map((r) => r.id)).toEqual([ev.id]);
  });

  it("hiding notifies the host; cancelling notifies registrants", async () => {
    const ev = await mkEvent();
    await addReg(ev.id);
    expect(
      await adminSetExchangeHidden({ eventId: ev.id, hidden: true }),
    ).toEqual({ success: true });
    const hid = await noticesOf("exchange_event_hidden");
    expect(hid).toHaveLength(1);
    expect(hid[0].recipientId).toBe(host.id);
    expect(mocks.updateTag).toHaveBeenCalledWith("exchange");

    // Ẩn lần hai khi đã ẩn: không gửi tin thứ hai.
    await adminSetExchangeHidden({ eventId: ev.id, hidden: true });
    expect(await noticesOf("exchange_event_hidden")).toHaveLength(1);

    expect(
      await adminSetExchangeHidden({ eventId: ev.id, hidden: false }),
    ).toEqual({ success: true });
    const [shown] = await testDb
      .select()
      .from(exchangeEvents)
      .where(eq(exchangeEvents.id, ev.id));
    expect(shown.hiddenAt).toBeNull();

    expect(await adminCancelExchange({ eventId: ev.id })).toEqual({
      success: true,
    });
    const canc = await noticesOf("exchange_event_cancelled");
    expect(canc.map((n) => n.recipientId)).toEqual([guest.id]);
    // Gọi lặp: buổi đã huỷ, trả lỗi và không gửi thêm.
    expect(await adminCancelExchange({ eventId: ev.id })).toHaveProperty(
      "error",
    );
    expect(await noticesOf("exchange_event_cancelled")).toHaveLength(1);
  });

  it("rejects bad input and unknown events", async () => {
    expect(
      await adminSetExchangeHidden({ eventId: "x", hidden: true }),
    ).toEqual({ error: "invalidInput" });
    expect(
      await adminSetExchangeHidden({ eventId: 99999, hidden: true }),
    ).toEqual({ error: "notFound" });
    expect(await adminCancelExchange({ eventId: 99999 })).toEqual({
      error: "notFound",
    });
  });

  it("lists reports with target links and resolving sets resolvedAt", async () => {
    const ev = await mkEvent();
    const [r1] = await testDb
      .insert(abuseReports)
      .values({
        reporterMemberId: guest.id,
        targetType: "event",
        targetId: ev.id,
        reason: "spam",
        createdAt: iso(-2000),
      })
      .returning();
    await testDb.insert(abuseReports).values({
      reporterMemberId: guest.id,
      targetType: "member",
      targetId: host.id,
      reason: "abusive",
      createdAt: iso(-1000),
    });
    const list = await adminListReports("open");
    if ("error" in list) throw new Error(list.error);
    expect(list.data).toHaveLength(2);
    const evRow = list.data.find((r) => r.id === r1.id)!;
    expect(evRow).toMatchObject({
      targetType: "event",
      eventCode: ev.publicCode,
      targetName: ev.title,
      reporterName: "Guest B",
    });
    const memRow = list.data.find((r) => r.targetType === "member")!;
    expect(memRow.targetName).toBe("Host A");
    expect(memRow.eventCode).toBeNull();
    expect(JSON.stringify(list.data)).not.toContain("0900000001");
    expect(JSON.stringify(list.data)).not.toContain("host@example.com");

    expect(
      await adminResolveReport({ reportId: r1.id, status: "resolved" }),
    ).toEqual({ success: true });
    const [after] = await testDb
      .select()
      .from(abuseReports)
      .where(eq(abuseReports.id, r1.id));
    expect(after.status).toBe("resolved");
    expect(after.resolvedAt).not.toBeNull();
    const open = await adminListReports("open");
    if ("error" in open) throw new Error(open.error);
    expect(open.data).toHaveLength(1);

    expect(
      await adminResolveReport({ reportId: 99999, status: "dismissed" }),
    ).toEqual({ error: "notFound" });
    expect(
      await adminResolveReport({ reportId: r1.id, status: "open" }),
    ).toEqual({ error: "invalidInput" });
  });
});

describe("admin comment moderation", () => {
  async function seedComment(
    eventId: number,
    over: Partial<typeof exchangeComments.$inferInsert> = {},
  ) {
    const [c] = await testDb
      .insert(exchangeComments)
      .values({
        eventId,
        authorMemberId: guest.id,
        channel: "qa",
        body: "noi dung binh luan",
        status: "visible",
        createdAt: iso(0),
        ...over,
      })
      .returning();
    return c;
  }
  let reporterSeq = 0;
  async function report(
    commentId: number,
    status: "open" | "resolved" = "open",
  ) {
    reporterSeq += 1;
    const [m] = await testDb
      .insert(members)
      .values({ name: `Rep${reporterSeq}`, approvalStatus: "approved" })
      .returning();
    await testDb.insert(abuseReports).values({
      reporterMemberId: m.id,
      targetType: "comment",
      targetId: commentId,
      reason: "spam",
      status,
      createdAt: iso(0),
    });
  }
  const reportStatuses = async (commentId: number) =>
    (
      await testDb
        .select({ s: abuseReports.status })
        .from(abuseReports)
        .where(eq(abuseReports.targetId, commentId))
    ).map((r) => r.s);
  const statusOf = async (id: number) =>
    (
      await testDb
        .select({ s: exchangeComments.status, p: exchangeComments.pinned })
        .from(exchangeComments)
        .where(eq(exchangeComments.id, id))
    )[0];

  it("admin comment actions refuse a member cookie", async () => {
    const ev = await mkEvent();
    const c = await seedComment(ev.id, { status: "held" });
    mocks.admin.mockResolvedValue({ error: "Không có quyền admin" });
    expect(await adminListComments("held")).toEqual({
      error: "Không có quyền admin",
    });
    expect(
      await adminModerateComment({ commentId: c.id, action: "approve" }),
    ).toHaveProperty("error");
    expect((await statusOf(c.id)).s).toBe("held");
  });

  it("admin lists held, hidden and reported comments with counts", async () => {
    const ev = await mkEvent();
    const held = await seedComment(ev.id, { status: "held" });
    const hidden = await seedComment(ev.id, { status: "hidden" });
    const rep1 = await seedComment(ev.id, { body: "x".repeat(10) });
    const rep2 = await seedComment(ev.id, { authorMemberId: host.id });
    await seedComment(ev.id);
    await report(rep1.id);
    await report(rep2.id);
    await report(rep2.id);
    await report(rep2.id, "resolved");

    const h = await adminListComments("held");
    expect(h).toMatchObject({ success: true });
    if (!("data" in h)) throw new Error("no data");
    expect(h.data.map((r) => r.id)).toEqual([held.id]);
    expect(h.data[0]).toMatchObject({
      eventCode: ev.publicCode,
      eventTitle: ev.title,
      channel: "qa",
      authorName: "Guest B",
      authorIsHost: false,
      status: "held",
      openReports: 0,
    });

    const hd = await adminListComments("hidden");
    if (!("data" in hd)) throw new Error("no data");
    expect(hd.data.map((r) => r.id)).toEqual([hidden.id]);

    const rp = await adminListComments("reported");
    if (!("data" in rp)) throw new Error("no data");
    expect(rp.data.map((r) => [r.id, r.openReports, r.authorIsHost])).toEqual([
      [rep2.id, 2, true],
      [rep1.id, 1, false],
    ]);
    expect(JSON.stringify(rp)).not.toContain("0900000001");
    expect(await adminListComments("bogus")).toHaveProperty("error");
  });

  it("report list shows the event title, code and excerpt for a comment target", async () => {
    const ev = await mkEvent();
    const long = "a".repeat(200);
    const c = await seedComment(ev.id, { body: long, status: "deleted" });
    await report(c.id);
    const res = await adminListReports("open");
    if (!("data" in res)) throw new Error("no data");
    expect(res.data).toHaveLength(1);
    expect(res.data[0]).toMatchObject({
      targetType: "comment",
      targetName: ev.title,
      eventCode: ev.publicCode,
      commentExcerpt: "a".repeat(120),
    });
  });

  it("admin approve publishes a held comment", async () => {
    const ev = await mkEvent();
    const c = await seedComment(ev.id, { status: "held" });
    expect(
      await adminModerateComment({ commentId: c.id, action: "approve" }),
    ).toEqual({ success: true });
    expect((await statusOf(c.id)).s).toBe("visible");
    expect(mocks.updateTag).toHaveBeenCalledWith(`xcmt:e${ev.id}`);
    expect(mocks.updateTag).not.toHaveBeenCalledWith("exchange");
    expect(
      await adminModerateComment({ commentId: c.id, action: "approve" }),
    ).toEqual({ error: "commentNotFound" });
  });

  it("admin unhide restores the comment and dismisses open reports; dismiss keeps it", async () => {
    const ev = await mkEvent();
    const c = await seedComment(ev.id, { status: "hidden" });
    await report(c.id);
    await report(c.id, "resolved");
    expect(
      await adminModerateComment({ commentId: c.id, action: "unhide" }),
    ).toEqual({ success: true });
    expect((await statusOf(c.id)).s).toBe("visible");
    expect((await reportStatuses(c.id)).sort()).toEqual([
      "dismissed",
      "resolved",
    ]);

    const d = await seedComment(ev.id);
    await report(d.id);
    mocks.updateTag.mockClear();
    expect(
      await adminModerateComment({ commentId: d.id, action: "dismiss" }),
    ).toEqual({ success: true });
    expect((await statusOf(d.id)).s).toBe("visible");
    expect(await reportStatuses(d.id)).toEqual(["dismissed"]);
    // Bỏ qua báo cáo không đổi gì khách thấy: không làm mới cache bình luận.
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });

  it("admin delete resolves open reports", async () => {
    const ev = await mkEvent();
    const c = await seedComment(ev.id, { pinned: true });
    await report(c.id);
    await report(c.id);
    expect(
      await adminModerateComment({ commentId: c.id, action: "delete" }),
    ).toEqual({ success: true });
    expect(await statusOf(c.id)).toEqual({ s: "deleted", p: false });
    expect(await reportStatuses(c.id)).toEqual(["resolved", "resolved"]);
    expect(mocks.updateTag).toHaveBeenCalledWith(`xcmt:e${ev.id}`);
  });
});

describe("admin reports on venues and reviews", () => {
  let n = 0;
  async function reporter(approvalStatus: "approved" | "pending" = "approved") {
    n += 1;
    const [m] = await testDb
      .insert(members)
      .values({ name: `VRep${n}`, approvalStatus })
      .returning();
    return m;
  }
  async function seedReview(
    over: Partial<typeof venueReviews.$inferInsert> = {},
  ) {
    const author = await reporter();
    const [r] = await testDb
      .insert(venueReviews)
      .values({
        venueId: venue.id,
        memberId: author.id,
        scoreSurface: 3,
        scoreLighting: 3,
        scoreVentilation: 3,
        scorePrice: 3,
        scoreParking: 3,
        scoreOwner: 3,
        comment: "b".repeat(200),
        raterWeight: 5,
        createdAt: iso(-DAY),
        updatedAt: iso(-DAY),
        ...over,
      })
      .returning();
    return r;
  }
  async function reportOn(
    targetType: "review" | "venue" | "event",
    targetId: number,
    by?: { id: number },
  ) {
    const m = by ?? (await reporter());
    const [row] = await testDb
      .insert(abuseReports)
      .values({
        reporterMemberId: m.id,
        targetType,
        targetId,
        reason: "spam",
        createdAt: iso(0),
      })
      .returning();
    return row;
  }

  it("admin report list shows venue name and excerpt for a review, venue name for a venue", async () => {
    const r = await seedReview();
    const short = await seedReview({ comment: null });
    await reportOn("review", r.id);
    await reportOn("review", short.id);
    await reportOn("venue", venue.id);
    const res = await adminListReports("open");
    if (!("data" in res)) throw new Error("no data");
    expect(res.data).toHaveLength(3);
    expect(
      res.data.find((x) => x.targetType === "review" && x.reviewExcerpt),
    ).toMatchObject({
      targetName: "San Z",
      venueId: venue.id,
      eventCode: null,
      commentExcerpt: null,
      reviewExcerpt: "b".repeat(120),
    });
    expect(
      res.data.find((x) => x.targetType === "review" && !x.reviewExcerpt),
    ).toMatchObject({
      targetName: "San Z",
      venueId: venue.id,
      reviewExcerpt: null,
    });
    expect(res.data.find((x) => x.targetType === "venue")).toMatchObject({
      targetName: "San Z",
      venueId: venue.id,
      eventCode: null,
      commentExcerpt: null,
      reviewExcerpt: null,
    });
    // Báo cáo kiểu cũ có hai trường mới là null.
    const ev = await mkEvent();
    await reportOn("event", ev.id);
    const again = await adminListReports("open");
    if (!("data" in again)) throw new Error("no data");
    expect(again.data.find((x) => x.targetType === "event")).toMatchObject({
      venueId: null,
      reviewExcerpt: null,
    });
  });

  it("resolving a review report in the reports tab lowers report_count", async () => {
    const r = await seedReview({ status: "hidden", reportCount: 3 });
    const a = await reportOn("review", r.id);
    await reportOn("review", r.id);
    await reportOn("review", r.id);
    // Báo cáo của nick mới không tính vào số đếm.
    await reportOn("review", r.id, await reporter("pending"));
    expect(
      await adminResolveReport({ reportId: a.id, status: "resolved" }),
    ).toEqual({ success: true });
    const [after] = await testDb
      .select({ s: venueReviews.status, n: venueReviews.reportCount })
      .from(venueReviews)
      .where(eq(venueReviews.id, r.id));
    // Trạng thái ẩn chỉ đổi ở tab Uy tín.
    expect(after).toEqual({ s: "hidden", n: 2 });

    // Báo cáo đích khác không đụng số đếm của đánh giá.
    const other = await seedReview({ reportCount: 1 });
    const ve = await reportOn("venue", venue.id);
    expect(
      await adminResolveReport({ reportId: ve.id, status: "dismissed" }),
    ).toEqual({ success: true });
    const [o] = await testDb
      .select({ n: venueReviews.reportCount })
      .from(venueReviews)
      .where(eq(venueReviews.id, other.id));
    expect(o.n).toBe(1);
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  abuseReports,
  exchangeEvents,
  exchangeRegistrations,
  hostFlagReviews,
  members,
  venueReviews,
  venues,
} from "@/db/schema";
import { eq, sql } from "drizzle-orm";

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
// Trần 5000 dòng hạ xuống 30 để test được nhánh `truncated` mà không seed 5000 dòng.
vi.mock("@/lib/reputation/constants", async (orig) => ({
  ...(await orig<typeof import("@/lib/reputation/constants")>()),
  HOST_FLAG_ROW_CAP: 30,
}));

const { db: testDb } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const mod = await import("./reputation-admin");
const { hostFlagRowsQuery } = await import("@/lib/reputation/host-flag-rows");
const {
  adminListHostFlags,
  adminListVenueReviews,
  adminModerateVenueReview,
  adminReviewHostFlag,
} = mod;

const DAY = 86_400_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const [venue] = await testDb
  .insert(venues)
  .values({ name: "San Rep", lat: 10, lng: 106, status: "approved" })
  .returning();
const [host] = await testDb
  .insert(members)
  .values({
    name: "Host Rep",
    approvalStatus: "approved",
    publicCode: "hostrep001",
    phoneNumber: "0900000009",
    email: "hostrep@example.com",
  })
  .returning();
const [otherHost] = await testDb
  .insert(members)
  .values({ name: "Host Khac", approvalStatus: "approved" })
  .returning();
// 3 người báo cáo "đã quen" (approved).
const reporters = await testDb
  .insert(members)
  .values(
    [1, 2, 3].map((i) => ({
      name: `Reporter ${i}`,
      approvalStatus: "approved" as const,
    })),
  )
  .returning();
// 52 tác giả đánh giá (venue_reviews unique theo venue + member).
const authors = await testDb
  .insert(members)
  .values(
    Array.from({ length: 52 }, (_, i) => ({
      name: `Author ${i}`,
      approvalStatus: "approved" as const,
      phoneNumber: `09111111${String(i).padStart(2, "0")}`,
    })),
  )
  .returning();
// Tài khoản giao lưu chưa vào nhóm: ứng viên khách quen.
const guests = await testDb
  .insert(members)
  .values(
    Array.from({ length: 4 }, (_, i) => ({
      name: `Guest ${i}`,
      approvalStatus: "pending" as const,
      signupIntent: "exchange" as const,
    })),
  )
  .returning();
const [groupMember] = await testDb
  .insert(members)
  .values({ name: "Group Member", approvalStatus: "approved" })
  .returning();
const fillers = await testDb
  .insert(members)
  .values(
    Array.from({ length: 25 }, (_, i) => ({
      name: `Filler ${i}`,
      approvalStatus: "pending" as const,
      signupIntent: "exchange" as const,
    })),
  )
  .returning();

async function mkReview(
  memberId: number,
  over: Partial<typeof venueReviews.$inferInsert> = {},
) {
  const [r] = await testDb
    .insert(venueReviews)
    .values({
      venueId: venue.id,
      memberId,
      scoreSurface: 4,
      scoreLighting: 3,
      scoreVentilation: 5,
      scorePrice: 2,
      scoreParking: 4,
      scoreOwner: 1,
      comment: "san tot",
      raterWeight: 5,
      createdAt: iso(-DAY),
      updatedAt: iso(-DAY),
      ...over,
    })
    .returning();
  return r;
}
async function report(
  reviewId: number,
  reporterId: number,
  status: "open" | "resolved" | "dismissed" = "open",
) {
  await testDb.insert(abuseReports).values({
    reporterMemberId: reporterId,
    targetType: "review",
    targetId: reviewId,
    reason: "abusive",
    status,
    createdAt: iso(-1000),
  });
}
const reviewById = async (id: number) =>
  (await testDb.select().from(venueReviews).where(eq(venueReviews.id, id)))[0];
const reportsOf = (id: number) =>
  testDb.select().from(abuseReports).where(eq(abuseReports.targetId, id));

let seq = 0;
async function mkEvent(
  startOffsetMs: number,
  over: Partial<typeof exchangeEvents.$inferInsert> = {},
) {
  seq += 1;
  const [ev] = await testDb
    .insert(exchangeEvents)
    .values({
      publicCode: `rep${seq}`,
      hostMemberId: host.id,
      venueId: venue.id,
      title: `Buoi ${seq}`,
      startAt: iso(startOffsetMs),
      endAt: iso(startOffsetMs + 2 * 3_600_000),
      slotsTotal: 40,
      feeMode: "fixed",
      feeAmountMale: 50000,
      registerDeadline: iso(startOffsetMs - DAY),
      cancelDeadline: iso(startOffsetMs - DAY),
      status: "done",
      createdAt: iso(startOffsetMs - 2 * DAY),
      updatedAt: iso(startOffsetMs - 2 * DAY),
      ...over,
    })
    .returning();
  return ev;
}
async function checkIn(
  eventId: number,
  memberIds: number[],
  over: Partial<typeof exchangeRegistrations.$inferInsert> = {},
) {
  await testDb.insert(exchangeRegistrations).values(
    memberIds.map((memberId) => ({
      eventId,
      memberId,
      status: "approved" as const,
      maleCount: 1,
      femaleCount: 0,
      checkedIn: true,
      checkedInAt: iso(-DAY),
      createdAt: iso(-2 * DAY),
      updatedAt: iso(-2 * DAY),
      ...over,
    })),
  );
}
const g3 = () => guests.slice(0, 3).map((g) => g.id);

function ok<T>(r: { success: true; data: T } | { error: string }): T {
  if ("error" in r) throw new Error(r.error);
  return r.data;
}

beforeEach(async () => {
  await testDb.delete(abuseReports);
  await testDb.delete(venueReviews);
  await testDb.delete(hostFlagReviews);
  await testDb.delete(exchangeRegistrations);
  await testDb.delete(exchangeEvents);
  mocks.flag.mockReset().mockResolvedValue(true);
  mocks.admin.mockReset().mockResolvedValue({ admin: { sub: "1" } });
  mocks.updateTag.mockClear();
});

describe("venue review moderation", () => {
  it("admin lists held, hidden and reported reviews with counts, at most 50, reported sorted in SQL", async () => {
    // Đánh giá ẩn có id NHỎ nhất và nhiều báo cáo mở nhất (3), đánh giá giữ cuối
    // có id LỚN nhất với 2 báo cáo: 52 đánh giá bị báo, cắt còn 50. Chỉ khi sắp
    // theo số báo cáo trong SQL trước LIMIT thì cả hai cùng còn và đứng đầu.
    const hidden = await mkReview(authors[51].id, {
      status: "hidden",
      reportCount: 3,
    });
    for (const rep of reporters) await report(hidden.id, rep.id);
    // 51 đánh giá bị giữ, mỗi cái 1 báo cáo mở; updatedAt tăng dần theo i.
    const held = [];
    for (let i = 0; i < 51; i++)
      held.push(
        await mkReview(authors[i].id, {
          status: "held",
          holdReason: "contact",
          updatedAt: iso(-DAY + i * 1000),
        }),
      );
    for (const r of held) await report(r.id, reporters[0].id);
    await report(held[50].id, reporters[1].id);

    const heldList = ok(await adminListVenueReviews("held"));
    expect(heldList).toHaveLength(50);
    expect(heldList[0].id).toBe(held[50].id);
    expect(heldList.map((r) => r.id)).not.toContain(held[0].id);
    expect(heldList[0]).toEqual({
      id: held[50].id,
      venueId: venue.id,
      venueName: "San Rep",
      authorName: "Author 50",
      scores: {
        surface: 4,
        lighting: 3,
        ventilation: 5,
        price: 2,
        parking: 4,
        owner: 1,
      },
      comment: "san tot",
      status: "held",
      holdReason: "contact",
      reportCount: 0,
      openReports: 2,
      createdAt: held[50].createdAt,
      updatedAt: held[50].updatedAt,
    });
    const json = JSON.stringify(heldList);
    expect(json).not.toContain("0911111150");
    expect(json).not.toContain("hostrep@example.com");

    const hiddenList = ok(await adminListVenueReviews("hidden"));
    expect(hiddenList.map((r) => [r.id, r.reportCount, r.openReports])).toEqual(
      [[hidden.id, 3, 3]],
    );

    const reported = ok(await adminListVenueReviews("reported"));
    expect(reported).toHaveLength(50);
    expect(reported[0]).toMatchObject({ id: hidden.id, openReports: 3 });
    expect(reported[1]).toMatchObject({ id: held[50].id, openReports: 2 });
    expect(reported.slice(2).every((r) => r.openReports === 1)).toBe(true);

    // Báo cáo đã đóng không đưa đánh giá vào danh sách "bị báo cáo".
    await testDb.delete(abuseReports);
    await report(hidden.id, reporters[0].id, "dismissed");
    expect(ok(await adminListVenueReviews("reported"))).toEqual([]);
    expect(await adminListVenueReviews("visible")).toEqual({
      error: "invalidInput",
    });
  });

  it("approve shows a held review and refreshes the venue cache; unhide resets report_count; hide resolves open reports", async () => {
    const held = await mkReview(authors[0].id, {
      status: "held",
      holdReason: "contact",
    });
    expect(
      await adminModerateVenueReview({ reviewId: held.id, action: "approve" }),
    ).toEqual({ success: true });
    const approved = await reviewById(held.id);
    expect(approved.status).toBe("visible");
    expect(approved.holdReason).toBeNull();
    expect(mocks.updateTag.mock.calls).toEqual([
      [`vrev:v${venue.id}`],
      ["vrev:all"],
    ]);
    // Bấm lặp: không còn ở `held`, không làm mới cache lần hai.
    mocks.updateTag.mockClear();
    expect(
      await adminModerateVenueReview({ reviewId: held.id, action: "approve" }),
    ).toEqual({ error: "reviewNotFound" });
    expect(mocks.updateTag).not.toHaveBeenCalled();

    const hidden = await mkReview(authors[1].id, {
      status: "hidden",
      reportCount: 3,
    });
    for (const rep of reporters) await report(hidden.id, rep.id);
    expect(
      await adminModerateVenueReview({ reviewId: hidden.id, action: "unhide" }),
    ).toEqual({ success: true });
    const shown = await reviewById(hidden.id);
    expect(shown.status).toBe("visible");
    expect(shown.reportCount).toBe(0);
    const unhideReports = await reportsOf(hidden.id);
    expect(unhideReports.map((r) => r.status)).toEqual([
      "dismissed",
      "dismissed",
      "dismissed",
    ]);
    expect(unhideReports.every((r) => r.resolvedAt !== null)).toBe(true);
    expect(mocks.updateTag).toHaveBeenCalledWith(`vrev:v${venue.id}`);
    expect(mocks.updateTag).toHaveBeenCalledWith("vrev:all");

    const visible = await mkReview(authors[2].id, { reportCount: 2 });
    await report(visible.id, reporters[0].id);
    await report(visible.id, reporters[1].id);
    await report(visible.id, reporters[2].id, "dismissed");
    mocks.updateTag.mockClear();
    expect(
      await adminModerateVenueReview({ reviewId: visible.id, action: "hide" }),
    ).toEqual({ success: true });
    expect((await reviewById(visible.id)).status).toBe("hidden");
    expect((await reportsOf(visible.id)).map((r) => r.status).sort()).toEqual([
      "dismissed",
      "resolved",
      "resolved",
    ]);
    expect(mocks.updateTag.mock.calls).toEqual([
      [`vrev:v${venue.id}`],
      ["vrev:all"],
    ]);
    // Ẩn lần hai: đã ẩn rồi.
    expect(
      await adminModerateVenueReview({ reviewId: visible.id, action: "hide" }),
    ).toEqual({ error: "reviewNotFound" });

    // Bỏ qua báo cáo: đóng báo cáo mở, đưa report_count về 0, không đổi trạng thái.
    const reportedOne = await mkReview(authors[3].id, { reportCount: 2 });
    await report(reportedOne.id, reporters[0].id);
    await report(reportedOne.id, reporters[1].id);
    expect(
      await adminModerateVenueReview({
        reviewId: reportedOne.id,
        action: "dismiss",
      }),
    ).toEqual({ success: true });
    const dismissed = await reviewById(reportedOne.id);
    expect(dismissed.status).toBe("visible");
    expect(dismissed.reportCount).toBe(0);
    expect(
      (await reportsOf(reportedOne.id)).every((r) => r.status === "dismissed"),
    ).toBe(true);

    expect(
      await adminModerateVenueReview({ reviewId: 999_999, action: "hide" }),
    ).toEqual({ error: "reviewNotFound" });
    expect(
      await adminModerateVenueReview({ reviewId: held.id, action: "delete" }),
    ).toEqual({ error: "invalidInput" });
  });
});

describe("host flags", () => {
  // Final review M4: hồ sơ host bị khoá hay bị từ chối trả 404, không có link.
  it("a locked or rejected flagged host has hostCode null", async () => {
    await seedThree(-30 * DAY);
    const codeNow = async () => ok(await adminListHostFlags()).rows[0].hostCode;
    expect(await codeNow()).toBe("hostrep001");
    try {
      await testDb
        .update(members)
        .set({ isActive: false })
        .where(eq(members.id, host.id));
      expect(await codeNow()).toBeNull();
      await testDb
        .update(members)
        .set({ isActive: true, approvalStatus: "rejected" })
        .where(eq(members.id, host.id));
      expect(await codeNow()).toBeNull();
    } finally {
      await testDb
        .update(members)
        .set({ isActive: true, approvalStatus: host.approvalStatus })
        .where(eq(members.id, host.id));
    }
  });

  /** 3 khách quen ở 2 buổi trong cửa sổ + buổi thứ ba do `third` quyết định. */
  async function seedThree(
    thirdOffsetMs: number,
    over: Partial<typeof exchangeEvents.$inferInsert> = {},
  ) {
    const e1 = await mkEvent(-10 * DAY);
    const e2 = await mkEvent(-20 * DAY);
    const e3 = await mkEvent(thirdOffsetMs, over);
    for (const ev of [e1, e2, e3]) await checkIn(ev.id, g3());
    return [e1, e2, e3];
  }

  it("host flags use the last 90 days, skip hidden or cancelled events, and report truncated at the cap", async () => {
    await seedThree(-89 * DAY);
    // Member nhóm đi cùng mọi buổi: không bao giờ là khách quen.
    const evs = await testDb.select().from(exchangeEvents);
    for (const ev of evs) await checkIn(ev.id, [groupMember.id]);
    expect(ok(await adminListHostFlags())).toEqual({
      rows: [
        {
          hostMemberId: host.id,
          hostName: "Host Rep",
          hostCode: "hostrep001",
          captives: 3,
          events: 3,
          reviewedCaptives: null,
        },
      ],
      truncated: false,
    });

    const variants: Array<
      [string, number, Partial<typeof exchangeEvents.$inferInsert>]
    > = [
      ["older than 90 days", -91 * DAY, {}],
      ["hidden", -30 * DAY, { hiddenAt: iso(-DAY) }],
      ["cancelled", -30 * DAY, { status: "cancelled", cancelledAt: iso(-DAY) }],
    ];
    for (const [label, offset, over] of variants) {
      await testDb.delete(exchangeRegistrations);
      await testDb.delete(exchangeEvents);
      await seedThree(offset, over);
      expect(ok(await adminListHostFlags()), label).toEqual({
        rows: [],
        truncated: false,
      });
    }

    // Đăng ký không hợp lệ (chưa điểm danh, bị huỷ dù còn cờ điểm danh) không tính.
    await testDb.delete(exchangeRegistrations);
    await testDb.delete(exchangeEvents);
    const [e1, e2] = [await mkEvent(-10 * DAY), await mkEvent(-20 * DAY)];
    const e3 = await mkEvent(-30 * DAY);
    await checkIn(e1.id, g3());
    await checkIn(e2.id, g3());
    await checkIn(e3.id, g3().slice(0, 2));
    await checkIn(e3.id, [g3()[2]], { status: "cancelled" });
    expect(ok(await adminListHostFlags()).rows).toEqual([]);

    // Trần dòng (30 khi test): 25 dòng mới hơn của host khác đẩy buổi cũ ra
    // ngoài (ORDER BY start_at DESC), cờ mất và danh sách báo `truncated`.
    await testDb.delete(exchangeRegistrations);
    await testDb.delete(exchangeEvents);
    await seedThree(-30 * DAY);
    expect(ok(await adminListHostFlags()).rows).toHaveLength(1);
    const recent = await mkEvent(-DAY, { hostMemberId: otherHost.id });
    await checkIn(
      recent.id,
      fillers.map((f) => f.id),
    );
    expect(ok(await adminListHostFlags())).toEqual({
      rows: [],
      truncated: true,
    });
  });

  it("reviewing a flag hides it until the captive count grows; a client-sent count is ignored", async () => {
    const evs = await seedThree(-30 * DAY);
    expect(
      await adminReviewHostFlag({ hostMemberId: host.id, captives: 99 }),
    ).toEqual({ success: true, data: { captives: 3 } });
    const stored = await testDb.select().from(hostFlagReviews);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ hostMemberId: host.id, captives: 3 });
    expect(ok(await adminListHostFlags()).rows).toEqual([]);

    // Khách quen thứ tư: cờ hiện lại với số đã xem.
    for (const ev of evs) await checkIn(ev.id, [guests[3].id]);
    expect(ok(await adminListHostFlags()).rows).toEqual([
      expect.objectContaining({
        hostMemberId: host.id,
        captives: 4,
        reviewedCaptives: 3,
      }),
    ]);

    // Xem lại: cập nhật đúng một dòng.
    expect(await adminReviewHostFlag({ hostMemberId: host.id })).toEqual({
      success: true,
      data: { captives: 4 },
    });
    const again = await testDb.select().from(hostFlagReviews);
    expect(again).toHaveLength(1);
    expect(again[0].captives).toBe(4);
    expect(ok(await adminListHostFlags()).rows).toEqual([]);

    expect(await adminReviewHostFlag({ hostMemberId: 999_999 })).toEqual({
      error: "notFound",
    });
    expect(await adminReviewHostFlag({ hostMemberId: "1" })).toEqual({
      error: "invalidInput",
    });
  });

  it("every admin action refuses a member cookie and a flag that is off", async () => {
    await seedThree(-30 * DAY);
    const r = await mkReview(authors[0].id, {
      status: "held",
      holdReason: "contact",
    });
    const calls = () => [
      adminListVenueReviews("held"),
      adminModerateVenueReview({ reviewId: r.id, action: "approve" }),
      adminListHostFlags(),
      adminReviewHostFlag({ hostMemberId: host.id }),
    ];

    mocks.flag.mockResolvedValue(false);
    for (const res of await Promise.all(calls()))
      expect(res).toEqual({ error: "notFound" });
    expect(mocks.admin).not.toHaveBeenCalled();

    mocks.flag.mockResolvedValue(true);
    mocks.admin.mockResolvedValue({ error: "Không có quyền admin" });
    for (const res of await Promise.all(calls()))
      expect(res).toEqual({ error: "Không có quyền admin" });
    // Input hỏng với cookie member: lỗi quyền, không phải invalidInput (zod sau requireAdmin).
    for (const res of await Promise.all([
      adminListVenueReviews("visible"),
      adminModerateVenueReview({ reviewId: "x", action: "delete" }),
      adminReviewHostFlag({ hostMemberId: -1 }),
    ]))
      expect(res).toEqual({ error: "Không có quyền admin" });

    expect((await reviewById(r.id)).status).toBe("held");
    expect(await testDb.select().from(hostFlagReviews)).toEqual([]);
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });
  it("EXPLAIN QUERY PLAN of the host-flag scan searches events by status and start_at, then registrations by event, no SCAN", async () => {
    const since = iso(-90 * DAY);
    const plan = await testDb.all<{ detail: string }>(
      sql`EXPLAIN QUERY PLAN ${hostFlagRowsQuery(testDb, since).getSQL()}`,
    );
    const details = plan.map((p) => p.detail);
    expect(details.filter((d) => /\bSCAN\b/.test(d))).toEqual([]);
    expect(
      details.some((d) => d.includes("exchange_events_status_start_idx")),
    ).toBe(true);
    expect(
      details.some((d) =>
        d.includes("exchange_registrations_event_status_idx"),
      ),
    ).toBe(true);
  });
});

describe("server action boundary", () => {
  it("reputation-admin exports exactly adminListHostFlags, adminListVenueReviews, adminModerateVenueReview, adminReviewHostFlag", () => {
    expect(Object.keys(mod).sort()).toEqual([
      "adminListHostFlags",
      "adminListVenueReviews",
      "adminModerateVenueReview",
      "adminReviewHostFlag",
    ]);
  });
});

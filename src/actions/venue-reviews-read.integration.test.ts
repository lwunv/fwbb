import { describe, it, expect, vi, beforeEach } from "vitest";
import { eq, sql, type SQL } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import { members, venueReviews, venues } from "@/db/schema";
import type { VenueStatus } from "@/lib/venue-amenities";
import type { CacheStore } from "@/test-utils/next-cache-store";

const mocks = vi.hoisted(() => ({ flag: vi.fn(async () => true) }));
vi.mock("@/lib/exchange-flag", () => ({ isExchangeEnabled: mocks.flag }));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));
vi.mock("next/cache", async () =>
  (await import("@/test-utils/next-cache-store")).createCacheStore(),
);

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const cache = (await import("next/cache")) as unknown as CacheStore;
const {
  getVenueReviewSummary,
  getVenueReviewPage,
  venueSumsQuery,
  venueReviewPageQuery,
} = await import("@/lib/reputation/venue-review-read");
const { listVenueReviews } = await import("./venue-reviews");
const { VENUE_CRITERIA, VENUE_REVIEWS_TAG, venueReviewTag } =
  await import("@/lib/reputation/constants");

type Scores = Partial<Record<(typeof VENUE_CRITERIA)[number], number>>;

let seq = 0;
async function seedMember(
  o: Partial<typeof members.$inferInsert> = {},
): Promise<number> {
  seq += 1;
  const [m] = await testDb
    .insert(members)
    .values({ name: `Reviewer ${seq}`, approvalStatus: "approved", ...o })
    .returning({ id: members.id });
  return m.id;
}

async function seedVenue(status: VenueStatus = "approved"): Promise<number> {
  const [v] = await testDb
    .insert(venues)
    .values({ name: `Venue ${++seq}`, lat: 21, lng: 105.8, status })
    .returning({ id: venues.id });
  return v.id;
}

let clock = Date.parse("2026-10-01T00:00:00.000Z");
async function review(
  venueId: number,
  o: {
    all?: number;
    scores?: Scores;
    weight?: number;
    status?: "visible" | "held" | "hidden";
    memberId?: number;
    comment?: string | null;
    createdAt?: string;
    editedAt?: string | null;
  } = {},
): Promise<number> {
  const s = (c: (typeof VENUE_CRITERIA)[number]) => o.scores?.[c] ?? o.all ?? 5;
  clock += 60_000;
  const createdAt = o.createdAt ?? new Date(clock).toISOString();
  const [r] = await testDb
    .insert(venueReviews)
    .values({
      venueId,
      memberId: o.memberId ?? (await seedMember()),
      scoreSurface: s("surface"),
      scoreLighting: s("lighting"),
      scoreVentilation: s("ventilation"),
      scorePrice: s("price"),
      scoreParking: s("parking"),
      scoreOwner: s("owner"),
      comment: o.comment ?? null,
      status: o.status ?? "visible",
      holdReason: o.status === "held" ? "contact" : null,
      reportCount: 2,
      raterWeight: o.weight ?? 5,
      createdAt,
      updatedAt: createdAt,
      editedAt: o.editedAt ?? null,
    })
    .returning({ id: venueReviews.id });
  return r.id;
}

const allCriteria = (v: number | null) =>
  Object.fromEntries(VENUE_CRITERIA.map((c) => [c, v]));

async function plan(q: SQL): Promise<string[]> {
  const rows = await testDb.all<{ detail: string }>(
    sql`EXPLAIN QUERY PLAN ${q}`,
  );
  return rows.map((r) => r.detail);
}

async function page(venueId: number, offset = 0) {
  const r = await listVenueReviews({ venueId, offset });
  if (!("success" in r)) throw new Error(`unexpected ${JSON.stringify(r)}`);
  return r.data!;
}

beforeEach(async () => {
  await client.execute("DELETE FROM venue_reviews");
  await client.execute("DELETE FROM venues");
  await client.execute("DELETE FROM members");
  cache.clear();
  mocks.flag.mockResolvedValue(true);
});

describe("getVenueReviewSummary", () => {
  it("summary uses only visible reviews of active accounts at approved venues", async () => {
    const a = await seedVenue();
    const b = await seedVenue();
    const hidden = await seedVenue("hidden");
    const pending = await seedVenue("pending");
    for (let i = 0; i < 3; i++) await review(a, { all: 5 });
    for (let i = 0; i < 3; i++) await review(b, { all: 1 });
    // Mọi dòng dưới đây phải bị bỏ qua, cả ở tổng của sân lẫn trung bình chung.
    await review(a, { all: 1, status: "held" });
    await review(a, { all: 1, status: "hidden" });
    await review(a, {
      all: 1,
      memberId: await seedMember({ isActive: false }),
    });
    await review(a, {
      all: 1,
      memberId: await seedMember({ approvalStatus: "rejected" }),
    });
    for (let i = 0; i < 3; i++) await review(hidden, { all: 5 });
    for (let i = 0; i < 3; i++) await review(pending, { all: 5 });

    // Trung bình chung = (3 * 5 + 3 * 1) / 6 = 3, kéo bằng 25 lượt ảo w5:
    // A: 10 * (75 * 30 + 25 * 90) / (40 * 30) = 37,5 → 38.
    // B: 10 * (15 * 30 + 25 * 90) / (40 * 30) = 22,5 → 23.
    expect(await getVenueReviewSummary(a)).toEqual({
      count: 3,
      overall: 38,
      criteria: allCriteria(38),
    });
    expect(await getVenueReviewSummary(b)).toEqual({
      count: 3,
      overall: 23,
      criteria: allCriteria(23),
    });
  });

  it("under 3 reviews the summary has the count and null scores", async () => {
    const v = await seedVenue();
    await review(v, { all: 4 });
    await review(v, { all: 2, weight: 1 });
    expect(await getVenueReviewSummary(v)).toEqual({
      count: 2,
      overall: null,
      criteria: allCriteria(null),
    });
    const empty = await seedVenue();
    expect(await getVenueReviewSummary(empty)).toEqual({
      count: 0,
      overall: null,
      criteria: allCriteria(null),
    });
  });

  it("a hidden venue's reviews are not listed and its sums are null", async () => {
    const v = await seedVenue();
    for (let i = 0; i < 3; i++) await review(v, { comment: `ok ${i}` });
    await testDb
      .update(venues)
      .set({ status: "hidden" })
      .where(eq(venues.id, v));
    expect(await getVenueReviewSummary(v)).toBeNull();
    expect(await page(v)).toEqual({
      reviews: [],
      hasMore: false,
      nextOffset: null,
    });
    expect(await getVenueReviewSummary(999_999)).toBeNull();
    expect(await getVenueReviewSummary(0)).toBeNull();
  });
});

describe("cache", () => {
  it("guest reading summary and page twice runs DB queries only the first time", async () => {
    const v = await seedVenue();
    for (let i = 0; i < 4; i++) await review(v, { comment: `c${i}` });
    const summary = await getVenueReviewSummary(v);
    const first = await page(v);
    expect(summary?.count).toBe(4);
    expect(first.reviews).toHaveLength(4);

    const keys = [...cache.store].map(([k, e]) => [JSON.parse(k)[0], e.tags]);
    expect(keys).toEqual(
      expect.arrayContaining([
        [["vrev-sum", String(v)], [venueReviewTag(v)]],
        [["vrev-prior"], [VENUE_REVIEWS_TAG]],
        [["vrev-page", String(v), "0"], [venueReviewTag(v)]],
      ]),
    );

    const exec = vi.spyOn(client, "execute");
    try {
      expect(await getVenueReviewSummary(v)).toEqual(summary);
      expect(await page(v)).toEqual(first);
      expect(exec).not.toHaveBeenCalled();
    } finally {
      exec.mockRestore();
    }
  });

  it("a new review clears that venue's sums and page, not the prior and not another venue", async () => {
    const a = await seedVenue();
    const b = await seedVenue();
    for (let i = 0; i < 3; i++) await review(a, { all: 5 });
    for (let i = 0; i < 3; i++) await review(b, { all: 1 });
    const a1 = await getVenueReviewSummary(a);
    const b1 = await getVenueReviewSummary(b);
    expect((await page(a)).reviews).toHaveLength(3);
    await page(b);

    // Đúng việc `submitVenueReview` làm sau commit: chỉ tag của sân đó.
    await review(a, { all: 1 });
    cache.updateTag(venueReviewTag(a));

    const keys = [...cache.store.keys()].map((k) => JSON.parse(k)[0]);
    expect(keys).toEqual(
      expect.arrayContaining([
        ["vrev-prior"],
        ["vrev-sum", String(b)],
        ["vrev-page", String(b), "0"],
      ]),
    );
    expect(keys).not.toContainEqual(["vrev-sum", String(a)]);
    expect(keys).not.toContainEqual(["vrev-page", String(a), "0"]);

    const a2 = await getVenueReviewSummary(a);
    expect(a2!.count).toBe(4);
    expect(a2!.overall).toBeLessThan(a1!.overall!);
    expect((await page(a)).reviews).toHaveLength(4);
    expect(await getVenueReviewSummary(b)).toEqual(b1);

    // Trung bình chung vẫn là bản cũ (chỉ làm mới theo giờ): tổng mới của A
    // ghép với prior cũ (6 dòng, trung bình 3) cho ra đúng số tính tay.
    // A: Σ = 5*(5+5+5+1) = 80, w = 20; 10 * (80 * 30 + 25 * 90) / (45 * 30) = 34,4 → 34.
    expect(a2!.overall).toBe(34);
  });
});

describe("listVenueReviews", () => {
  it("page JSON has month only, no createdAt, member id, name, weight, hold reason or report count", async () => {
    const v = await seedVenue();
    const author = await seedMember({ name: "Nguyễn Văn Lộ" });
    // 18:00 UTC ngày 31/10 là 01:00 ngày 1/11 giờ Việt Nam.
    const createdAt = "2026-10-31T18:00:00.000Z";
    const id = await review(v, {
      memberId: author,
      createdAt,
      comment: "Sân thoáng\nđèn sáng",
      scores: { surface: 4, lighting: 3, ventilation: 5, price: 2, parking: 1 },
      weight: 3,
      editedAt: "2026-11-02T00:00:00.000Z",
    });
    await review(v, { createdAt: "2026-09-15T00:00:00.000Z" });

    const data = await page(v);
    expect(Object.keys(data).sort()).toEqual([
      "hasMore",
      "nextOffset",
      "reviews",
    ]);
    const [r, older] = data.reviews;
    expect(Object.keys(r).sort()).toEqual([
      "comment",
      "edited",
      "id",
      "month",
      "scores",
    ]);
    expect(r).toEqual({
      id,
      scores: {
        surface: 4,
        lighting: 3,
        ventilation: 5,
        price: 2,
        parking: 1,
        owner: 5,
      },
      comment: "Sân thoáng\nđèn sáng",
      month: "2026-11",
      edited: true,
    });
    expect(older).toMatchObject({ month: "2026-09", edited: false });

    const json = JSON.stringify(data);
    for (const leak of [
      createdAt,
      "2026-10-31",
      "2026-11-02",
      "T00:00",
      "Nguyễn",
      "memberId",
      "member_id",
      "raterWeight",
      "weight",
      "holdReason",
      "reportCount",
      "status",
      "createdAt",
      "updatedAt",
      "editedAt",
    ]) {
      expect(json).not.toContain(leak);
    }
  });

  it("held and hidden reviews never appear", async () => {
    const v = await seedVenue();
    const shown = await review(v, { comment: "ok" });
    await review(v, { status: "held", comment: "gọi 0912 345 678" });
    await review(v, { status: "hidden", comment: "bị ẩn" });
    await review(v, {
      comment: "nick bị khoá",
      memberId: await seedMember({ isActive: false }),
    });
    const data = await page(v);
    expect(data.reviews.map((r) => r.id)).toEqual([shown]);
    expect(JSON.stringify(data)).not.toMatch(/0912|bị ẩn|bị khoá/);
  });

  it("pages of 10 newest first with hasMore and nextOffset; offset 15 or 1000 rejected", async () => {
    const v = await seedVenue();
    const ids: number[] = [];
    // Hai dòng cùng `created_at`: dòng id lớn hơn đứng trước.
    for (let i = 0; i < 23; i++) ids.push(await review(v));
    ids.push(await review(v, { createdAt: "2026-12-01T00:00:00.000Z" }));
    ids.push(await review(v, { createdAt: "2026-12-01T00:00:00.000Z" }));
    const newestFirst = [ids[24], ids[23], ...ids.slice(0, 23).reverse()];

    const p0 = await page(v, 0);
    expect(p0.reviews.map((r) => r.id)).toEqual(newestFirst.slice(0, 10));
    expect(p0).toMatchObject({ hasMore: true, nextOffset: 10 });
    const p1 = await page(v, 10);
    expect(p1.reviews.map((r) => r.id)).toEqual(newestFirst.slice(10, 20));
    expect(p1).toMatchObject({ hasMore: true, nextOffset: 20 });
    const p2 = await page(v, 20);
    expect(p2.reviews.map((r) => r.id)).toEqual(newestFirst.slice(20));
    expect(p2).toMatchObject({ hasMore: false, nextOffset: null });

    for (const bad of [
      { venueId: v, offset: 15 },
      { venueId: v, offset: 1000 },
      { venueId: v, offset: 500 },
      { venueId: v, offset: -10 },
      { venueId: v, offset: "0" },
      { venueId: 0, offset: 0 },
      { venueId: "1", offset: 0 },
      {},
      null,
    ]) {
      expect(await listVenueReviews(bad)).toEqual({ error: "invalidInput" });
    }
    expect(await listVenueReviews({ venueId: v, offset: 490 })).toEqual({
      success: true,
      data: { reviews: [], hasMore: false, nextOffset: null },
    });
  });

  it("a venueId past the safe integer range is rejected before any DB read", async () => {
    const exec = vi.spyOn(client, "execute");
    try {
      for (const venueId of [2 ** 53, Number.MAX_VALUE, 1.5]) {
        expect(await listVenueReviews({ venueId, offset: 0 })).toEqual({
          error: "invalidInput",
        });
      }
      expect(exec).not.toHaveBeenCalled();
      expect(cache.store.size).toBe(0);
    } finally {
      exec.mockRestore();
    }
  });

  it("a missing, pending or hidden venue leaves no review cache entry", async () => {
    const pending = await seedVenue("pending");
    const hidden = await seedVenue();
    for (let i = 0; i < 3; i++) await review(hidden);
    await testDb
      .update(venues)
      .set({ status: "hidden" })
      .where(eq(venues.id, hidden));
    const empty = { reviews: [], hasMore: false, nextOffset: null };

    for (const venueId of [987_654, pending, hidden]) {
      for (const offset of [0, 10, 20]) {
        expect(await listVenueReviews({ venueId, offset })).toEqual({
          success: true,
          data: empty,
        });
      }
      expect(await getVenueReviewSummary(venueId)).toBeNull();
    }
    expect([...cache.store.keys()]).toEqual([]);

    // Sân approved chưa có đánh giá vẫn được cache như cũ.
    const fresh = await seedVenue();
    expect(await page(fresh)).toEqual(empty);
    expect([...cache.store.keys()].map((k) => JSON.parse(k)[0])).toEqual([
      ["vrev-page", String(fresh), "0"],
    ]);
  });

  it("the last allowed page never offers a next offset past the cap", async () => {
    const v = await seedVenue();
    const r = await getVenueReviewPage(v, 490);
    expect(r).toEqual({ reviews: [], hasMore: false, nextOffset: null });
  });

  it("flag off: listVenueReviews returns notFound before any DB read", async () => {
    const v = await seedVenue();
    for (let i = 0; i < 3; i++) await review(v);
    mocks.flag.mockResolvedValue(false);
    const exec = vi.spyOn(client, "execute");
    try {
      expect(await listVenueReviews({ venueId: v, offset: 0 })).toEqual({
        error: "notFound",
      });
      expect(await listVenueReviews({ venueId: "bad" })).toEqual({
        error: "notFound",
      });
      expect(await getVenueReviewSummary(v)).toBeNull();
      expect(exec).not.toHaveBeenCalled();
      expect(cache.store.size).toBe(0);
    } finally {
      exec.mockRestore();
    }
  });
});

describe("query plans", () => {
  it("EXPLAIN QUERY PLAN of the venue sums uses venue_reviews_venue_status_created_idx", async () => {
    const details = await plan(venueSumsQuery(1));
    const text = details.join("\n");
    expect(text).toMatch(/venue_reviews_venue_status_created_idx/);
    expect(details.filter((d) => /\bSCAN\b/.test(d))).toEqual([]);
    const pagePlan = await plan(venueReviewPageQuery(1, 0));
    expect(pagePlan.join("\n")).toMatch(
      /venue_reviews_venue_status_created_idx/,
    );
    expect(pagePlan.filter((d) => /\bSCAN\b/.test(d))).toEqual([]);
  });
});

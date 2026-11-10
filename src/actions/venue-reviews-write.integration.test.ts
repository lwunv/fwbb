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
  admins,
  exchangeEvents,
  exchangeRegistrations,
  members,
  notifications,
  rateLimitBuckets,
  venueReviews,
  venues,
} from "@/db/schema";

const mocks = vi.hoisted(() => ({
  flag: vi.fn(),
  auth: vi.fn(),
  verify: vi.fn(),
  bot: vi.fn(),
  realBot: null as unknown as (...args: never[]) => unknown,
  updateTag: vi.fn(),
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/exchange-flag", () => ({ isExchangeEnabled: mocks.flag }));
vi.mock("@/lib/member-auth", () => ({ requireExchangeMember: mocks.auth }));
// checkBotAndRate chạy thật; chỉ phần gọi Cloudflare bị thay.
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: mocks.verify }));
vi.mock("@/lib/client-ip", () => ({
  getTrustedClientIp: async () => "unknown",
  ipRateLimitKey: () => "ip",
  hashedIpKey: () => "ip",
}));
vi.mock("@/lib/exchange/guards", async (orig) => {
  const real = await orig<typeof import("@/lib/exchange/guards")>();
  mocks.realBot = real.checkBotAndRate as never;
  return { ...real, checkBotAndRate: mocks.bot };
});
vi.mock("next/cache", () => ({
  updateTag: mocks.updateTag,
  revalidateTag: mocks.revalidateTag,
  revalidatePath: mocks.revalidatePath,
  unstable_cache: (fn: unknown) => fn,
}));
// Khoá kèm giá trị để kiểm được ngày trong lỗi "sửa quá sớm".
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(
    async () => (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  ),
  getLocale: vi.fn(async () => "vi"),
}));

const { db: testDb } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { submitVenueReview, getMyVenueReview } = await import("./venue-reviews");
const { enableNotificationsForTest } =
  await import("@/lib/notifications/test-helpers");

type Member = typeof members.$inferSelect;
type Venue = typeof venues.$inferSelect;
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = Date.parse("2026-11-05T00:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://fwbb.test");
  await testDb
    .insert(admins)
    .values({ username: "sa1", passwordHash: "x", role: "superadmin" });
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

let seq = 0;
async function newVenue(status: Venue["status"] = "approved"): Promise<Venue> {
  seq += 1;
  const [v] = await testDb
    .insert(venues)
    .values({ name: `San ${seq}`, lat: 10, lng: 106, status })
    .returning();
  return v;
}
async function newMember(
  over: Partial<typeof members.$inferInsert> = {},
): Promise<Member> {
  seq += 1;
  const [m] = await testDb
    .insert(members)
    .values({
      name: `Nguoi viet ${seq}`,
      approvalStatus: "pending",
      avatarKey: "k",
      ...over,
    })
    .returning();
  return m;
}
const host = await newMember({ approvalStatus: "approved", name: "Host" });

/** Member có `checkIns` lần điểm danh hợp lệ ở buổi giao lưu tại sân này. */
async function player(venue: Venue, checkIns = 1): Promise<Member> {
  const m = await newMember();
  for (let i = 0; i < checkIns; i += 1) {
    seq += 1;
    const [ev] = await testDb
      .insert(exchangeEvents)
      .values({
        publicCode: `vr${String(seq).padStart(8, "0")}`,
        hostMemberId: host.id,
        venueId: venue.id,
        title: "Giao luu",
        startAt: iso(NOW - 10 * DAY),
        endAt: iso(NOW - 10 * DAY + 2 * HOUR),
        slotsTotal: 10,
        feeMode: "fixed",
        registerDeadline: iso(NOW - 11 * DAY),
        cancelDeadline: iso(NOW - 11 * DAY),
        status: "done",
        createdAt: iso(NOW - 12 * DAY),
        updatedAt: iso(NOW - 12 * DAY),
      })
      .returning();
    await testDb.insert(exchangeRegistrations).values({
      eventId: ev.id,
      memberId: m.id,
      status: "approved",
      maleCount: 1,
      femaleCount: 0,
      checkedIn: true,
      createdAt: iso(NOW - 12 * DAY),
      updatedAt: iso(NOW - 12 * DAY),
    });
  }
  return m;
}

function asMember(m: Member) {
  mocks.auth.mockResolvedValue({
    user: { memberId: m.id, externalId: "x" },
    member: m,
  });
}

const SCORES = {
  surface: 4,
  lighting: 5,
  ventilation: 3,
  price: 4,
  parking: 2,
  owner: 5,
};
function payload(venueId: number, over: Record<string, unknown> = {}) {
  return {
    venueId,
    scores: SCORES,
    comment: "",
    idempotencyKey: randomUUID(),
    turnstileToken: "tok",
    ...over,
  };
}
async function submitAs(
  m: Member,
  venueId: number,
  over: Record<string, unknown> = {},
) {
  asMember(m);
  return submitVenueReview(payload(venueId, over));
}

/** Dòng đánh giá có sẵn (dữ liệu cũ), ghi thẳng vào DB. */
async function seedReview(
  venue: Venue,
  m: Member,
  over: Partial<typeof venueReviews.$inferInsert> = {},
) {
  const created = over.createdAt ?? iso(NOW - 2 * DAY);
  const [r] = await testDb
    .insert(venueReviews)
    .values({
      venueId: venue.id,
      memberId: m.id,
      scoreSurface: 3,
      scoreLighting: 3,
      scoreVentilation: 3,
      scorePrice: 3,
      scoreParking: 3,
      scoreOwner: 3,
      raterWeight: 5,
      createdAt: created,
      updatedAt: created,
      ...over,
    })
    .returning();
  return r;
}

const rowOf = async (venueId: number, memberId: number) =>
  (
    await testDb
      .select()
      .from(venueReviews)
      .where(
        and(
          eq(venueReviews.venueId, venueId),
          eq(venueReviews.memberId, memberId),
        ),
      )
  )[0];
const heldNotes = () =>
  testDb
    .select()
    .from(notifications)
    .where(eq(notifications.kind, "venue_review_held"));

beforeEach(async () => {
  vi.setSystemTime(NOW);
  mocks.flag.mockReset().mockResolvedValue(true);
  mocks.auth.mockReset();
  mocks.verify.mockReset().mockResolvedValue({ ok: true });
  mocks.bot.mockReset().mockImplementation(mocks.realBot);
  mocks.updateTag.mockReset();
  mocks.revalidateTag.mockReset();
  mocks.revalidatePath.mockReset();
  await testDb.delete(rateLimitBuckets);
  await testDb.delete(notifications);
});

describe("submitVenueReview: guards", () => {
  it("flag off returns notFound before auth and Turnstile", async () => {
    const venue = await newVenue();
    const m = await player(venue);
    asMember(m);
    mocks.flag.mockResolvedValue(false);
    const r = await submitVenueReview(payload(venue.id));
    expect(r).toEqual({ error: "notFound" });
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(await testDb.select().from(rateLimitBuckets)).toHaveLength(0);
    expect(await rowOf(venue.id, m.id)).toBeUndefined();
  });

  it("failed Turnstile writes no rate_limit_buckets row and no review", async () => {
    const venue = await newVenue();
    const m = await player(venue);
    mocks.verify.mockResolvedValue({ ok: false, reason: "invalid" });
    const r = await submitAs(m, venue.id);
    expect(r).toEqual({ error: "captcha" });
    expect(mocks.verify).toHaveBeenCalledWith(
      "tok",
      expect.objectContaining({ action: "venue_review" }),
    );
    expect(await testDb.select().from(rateLimitBuckets)).toHaveLength(0);
    expect(await rowOf(venue.id, m.id)).toBeUndefined();
  });

  it("comment over 500 characters rejected; empty stored as null", async () => {
    const venue = await newVenue();
    const m = await player(venue);
    for (const comment of ["a".repeat(501), "b".repeat(2001)]) {
      expect(await submitAs(m, venue.id, { comment })).toEqual({
        error: "invalidInput",
      });
    }
    expect(mocks.verify).not.toHaveBeenCalled();

    const r = await submitAs(m, venue.id, { comment: "  \n\n  " });
    expect(r).toMatchObject({ success: true, data: { status: "visible" } });
    expect((await rowOf(venue.id, m.id)).comment).toBeNull();

    // 500 ký tự sau khi bỏ khoảng trắng hai đầu vẫn hợp lệ.
    const other = await player(venue);
    const ok = await submitAs(other, venue.id, {
      comment: `   ${"c".repeat(500)}   `,
    });
    expect(ok).toMatchObject({ success: true });
    expect((await rowOf(venue.id, other.id)).comment).toBe("c".repeat(500));
  });

  it("score 0 or 6 rejected", async () => {
    const venue = await newVenue();
    const m = await player(venue);
    const bad = [
      { scores: { ...SCORES, surface: 0 } },
      { scores: { ...SCORES, owner: 6 } },
      { scores: { ...SCORES, price: 3.5 } },
      { scores: { surface: 4, lighting: 4, ventilation: 4, price: 4 } },
      { scores: { ...SCORES, extra: 3 } },
      { idempotencyKey: "not-a-uuid" },
      { turnstileToken: "" },
    ];
    for (const over of bad) {
      expect(await submitAs(m, venue.id, over)).toEqual({
        error: "invalidInput",
      });
    }
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(await testDb.select().from(rateLimitBuckets)).toHaveLength(0);
    expect(await rowOf(venue.id, m.id)).toBeUndefined();
  });

  it("pending or hidden venue gives reviewVenueNotFound", async () => {
    const approved = await newVenue();
    const m = await player(approved);
    for (const status of ["pending", "hidden"] as const) {
      const v = await newVenue(status);
      // Đã chơi ở sân đó, chỉ trạng thái sân chặn.
      const p = await player(v);
      expect(await submitAs(p, v.id)).toEqual({
        error: "reviewVenueNotFound",
      });
      expect(await rowOf(v.id, p.id)).toBeUndefined();
    }
    expect(await submitAs(m, 999_999)).toEqual({
      error: "reviewVenueNotFound",
    });
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });
});

describe("submitVenueReview: writes", () => {
  it("an eligible member posts a visible review with the snapshot weight", async () => {
    const venue = await newVenue();
    const m = await player(venue, 2);
    const key = randomUUID();
    const r = await submitAs(m, venue.id, {
      idempotencyKey: key,
      comment: "  Sân rộng, đèn sáng  ",
    });
    const row = await rowOf(venue.id, m.id);
    expect(r).toEqual({
      success: true,
      data: { id: row.id, status: "visible" },
    });
    expect(row).toMatchObject({
      scoreSurface: 4,
      scoreLighting: 5,
      scoreVentilation: 3,
      scorePrice: 4,
      scoreParking: 2,
      scoreOwner: 5,
      comment: "Sân rộng, đèn sáng",
      status: "visible",
      holdReason: null,
      reportCount: 0,
      raterWeight: 2,
      idempotencyKey: key,
      createdAt: iso(NOW),
      updatedAt: iso(NOW),
      editedAt: null,
    });
    const buckets = await testDb.select().from(rateLimitBuckets);
    expect(buckets.map((b) => b.key)).toEqual([`venue-review:${m.id}`]);
  });

  it("an ineligible member gets reviewNotEligible", async () => {
    const venue = await newVenue();
    const elsewhere = await newVenue();
    const stranger = await newMember();
    const playedElsewhere = await player(elsewhere, 3);
    for (const m of [stranger, playedElsewhere]) {
      expect(await submitAs(m, venue.id)).toEqual({
        error: "reviewNotEligible",
      });
      expect(await rowOf(venue.id, m.id)).toBeUndefined();
    }
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });

  it("a phone, a link or a banned word holds the review with its reason and notifies admins once per venue per hour", async () => {
    await enableNotificationsForTest(testDb);
    const venue = await newVenue();
    const cases = [
      ["Gọi 0912 345 678 để đặt sân", "contact"],
      ["Xem giá ở zalo.me/x nhé", "contact"],
      ["Chủ sân đm khó chịu", "banned"],
    ] as const;
    for (const [comment, reason] of cases) {
      const m = await player(venue);
      const r = await submitAs(m, venue.id, { comment });
      expect(r).toMatchObject({ success: true, data: { status: "held" } });
      const row = await rowOf(venue.id, m.id);
      expect(row.status).toBe("held");
      expect(row.holdReason).toBe(reason);
      expect(row.comment).toBe(comment);
    }
    // Một tin cho mỗi superadmin, dù 3 đánh giá bị giữ trong cùng giờ.
    let notes = await heldNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      recipientType: "admin",
      entityType: "venue",
      entityId: venue.id,
    });

    // Sân khác cùng giờ: tin riêng.
    const other = await newVenue();
    await submitAs(await player(other), other.id, {
      comment: "sđt 0912345678",
    });
    expect(await heldNotes()).toHaveLength(2);

    // Giờ sau: thêm một tin cho sân đầu.
    vi.setSystemTime(NOW + HOUR);
    await submitAs(await player(venue), venue.id, { comment: "vcl" });
    // Đánh giá sạch không báo.
    const clean = await newVenue();
    await submitAs(await player(clean), clean.id, { comment: "Sân đẹp" });
    notes = await heldNotes();
    expect(notes).toHaveLength(3);
  });

  it("payload has no reviewer name and no comment", async () => {
    await enableNotificationsForTest(testDb);
    const venue = await newVenue();
    const m = await player(venue);
    await submitAs(m, venue.id, { comment: "Liên hệ 0912 345 678" });
    const [note] = await heldNotes();
    expect(note.payload).toEqual({ venueName: venue.name });
    const json = JSON.stringify(note);
    expect(json).not.toContain(m.name);
    expect(json).not.toContain("0912");
    expect(note.dedupKey).not.toContain(String(m.id));
  });

  it("the fifth new review in 24 hours is held for anomaly, an edit is not", async () => {
    const venue = await newVenue();
    const early: Member[] = [];
    for (let i = 0; i < 3; i += 1) {
      const m = await player(venue, 5);
      early.push(m);
      await seedReview(venue, m, { createdAt: iso(NOW - (i + 1) * HOUR) });
    }
    // Dòng bị ẩn và dòng quá 24 giờ không tính: nếu tính một trong hai thì
    // lượt gửi thứ tư dưới đây đã thành thứ năm và bị giữ.
    await seedReview(venue, await player(venue, 5), {
      createdAt: iso(NOW - 2 * HOUR),
      status: "hidden",
    });
    await seedReview(venue, await player(venue, 5), {
      createdAt: iso(NOW - DAY - MIN),
    });

    const fourth = await player(venue, 5);
    expect(await submitAs(fourth, venue.id)).toMatchObject({
      success: true,
      data: { status: "visible" },
    });

    const fifth = await player(venue, 5);
    const r = await submitAs(fifth, venue.id);
    expect(r).toMatchObject({ success: true, data: { status: "held" } });
    expect((await rowOf(venue.id, fifth.id)).holdReason).toBe("anomaly");

    // Sửa đánh giá của người đã viết trước: chỉ kiểm nội dung.
    const edit = await submitAs(early[0], venue.id, { comment: "Sân ổn" });
    expect(edit).toMatchObject({ success: true, data: { status: "visible" } });
    const row = await rowOf(venue.id, early[0].id);
    expect(row.status).toBe("visible");
    expect(row.editedAt).toBe(iso(NOW));
  });

  it("the third review, two of them from accounts under 3 events, is held for anomaly", async () => {
    const venue = await newVenue();
    await seedReview(venue, await player(venue, 1), { raterWeight: 1 });
    await seedReview(venue, await player(venue, 2), { raterWeight: 2 });
    const established = await player(venue, 3);
    const r = await submitAs(established, venue.id);
    expect(r).toMatchObject({ success: true, data: { status: "held" } });
    const row = await rowOf(venue.id, established.id);
    expect(row.holdReason).toBe("anomaly");
    expect(row.raterWeight).toBe(3);

    // Một nick dưới 3 buổi trong 3 đánh giá: không quá nửa.
    const calm = await newVenue();
    await seedReview(calm, await player(calm, 1), { raterWeight: 1 });
    await seedReview(calm, await player(calm, 5));
    expect(await submitAs(await player(calm, 3), calm.id)).toMatchObject({
      data: { status: "visible" },
    });
  });

  it("after the admin approves the low-rep reviews, a new review from an established account is visible", async () => {
    const venue = await newVenue();
    await seedReview(venue, await player(venue, 5), {
      createdAt: iso(NOW - 5 * DAY),
    });
    await seedReview(venue, await player(venue, 1), {
      raterWeight: 1,
      createdAt: iso(NOW - 5 * DAY),
    });
    const l2 = await seedReview(venue, await player(venue, 1), {
      raterWeight: 1,
      status: "held",
      holdReason: "anomaly",
      createdAt: iso(NOW - 4 * DAY),
    });
    // Còn trong hàng chờ: không được tính vào luật quá nửa (I9).
    await seedReview(venue, await player(venue, 1), {
      raterWeight: 1,
      status: "held",
      holdReason: "anomaly",
      createdAt: iso(NOW - 4 * DAY),
    });
    // Admin duyệt (Task 11 làm đúng việc này).
    await testDb
      .update(venueReviews)
      .set({ status: "visible" })
      .where(eq(venueReviews.id, l2.id));

    const established = await player(venue, 5);
    const r = await submitAs(established, venue.id);
    expect(r).toMatchObject({ success: true, data: { status: "visible" } });
  });

  it("low-rep reviews older than 90 days do not hold new ones", async () => {
    const old = await newVenue();
    for (let i = 0; i < 2; i += 1) {
      await seedReview(old, await player(old, 1), {
        raterWeight: 1,
        createdAt: iso(NOW - 90 * DAY - MIN),
      });
    }
    expect(await submitAs(await player(old, 5), old.id)).toMatchObject({
      data: { status: "visible" },
    });

    const recent = await newVenue();
    for (let i = 0; i < 2; i += 1) {
      await seedReview(recent, await player(recent, 1), {
        raterWeight: 1,
        createdAt: iso(NOW - 89 * DAY),
      });
    }
    expect(await submitAs(await player(recent, 5), recent.id)).toMatchObject({
      data: { status: "held" },
    });
  });

  it("first edit right away is allowed; the next edit at 30 days minus 1 s is refused with the date; at exactly 30 days it is allowed", async () => {
    const venue = await newVenue();
    const m = await player(venue, 3);
    await submitAs(m, venue.id);

    const firstEdit = NOW + 2 * MIN;
    vi.setSystemTime(firstEdit);
    expect(
      await submitAs(m, venue.id, { scores: { ...SCORES, owner: 1 } }),
    ).toMatchObject({ success: true });
    let row = await rowOf(venue.id, m.id);
    expect(row.editedAt).toBe(iso(firstEdit));
    expect(row.scoreOwner).toBe(1);

    vi.setSystemTime(firstEdit + 30 * DAY - 1000);
    const early = await submitAs(m, venue.id, {
      scores: { ...SCORES, owner: 2 },
    });
    // firstEdit + 30 ngày = 2026-12-05T00:02Z = 07:02 ngày 05/12 giờ VN.
    expect(early).toEqual({
      error: 'reviewEditTooSoon:{"date":"05/12/2026"}',
    });
    expect((await rowOf(venue.id, m.id)).scoreOwner).toBe(1);

    vi.setSystemTime(firstEdit + 30 * DAY);
    expect(
      await submitAs(m, venue.id, { scores: { ...SCORES, owner: 2 } }),
    ).toMatchObject({ success: true });
    row = await rowOf(venue.id, m.id);
    expect(row.scoreOwner).toBe(2);
    expect(row.editedAt).toBe(iso(firstEdit + 30 * DAY));
  });

  it("a resend with the same idempotencyKey returns the stored id and status and is not an edit", async () => {
    await enableNotificationsForTest(testDb);
    const venue = await newVenue();
    const m = await player(venue, 3);
    const key = randomUUID();
    const first = await submitAs(m, venue.id, {
      idempotencyKey: key,
      comment: "Gọi 0912 345 678",
    });
    const before = await rowOf(venue.id, m.id);
    expect(first).toEqual({
      success: true,
      data: { id: before.id, status: "held" },
    });
    const buckets = await testDb.select().from(rateLimitBuckets);
    mocks.updateTag.mockReset();

    // Mất phản hồi: gửi lại với token đã dùng, nội dung khác, 5 phút sau.
    vi.setSystemTime(NOW + 5 * MIN);
    mocks.verify.mockResolvedValue({
      ok: false,
      reason: "timeout-or-duplicate",
    });
    const again = await submitAs(m, venue.id, {
      idempotencyKey: key,
      comment: "Sân sạch",
      scores: { ...SCORES, surface: 1 },
    });
    expect(again).toEqual(first);
    expect(await rowOf(venue.id, m.id)).toEqual(before);
    expect(await testDb.select().from(rateLimitBuckets)).toEqual(buckets);
    expect(mocks.updateTag).not.toHaveBeenCalled();
    expect(await heldNotes()).toHaveLength(1);

    // Lần sửa thật đầu tiên vẫn được làm ngay.
    mocks.verify.mockResolvedValue({ ok: true });
    expect(await submitAs(m, venue.id, { comment: "Sân sạch" })).toMatchObject({
      success: true,
      data: { status: "visible" },
    });
    expect((await rowOf(venue.id, m.id)).editedAt).toBe(iso(NOW + 5 * MIN));
  });

  it("two first submits from two tabs within a minute end with one row and no editedAt", async () => {
    // Hai transaction rate limit chạy cạnh transaction ghi trên file libsql sẽ
    // SQLITE_BUSY (xem test hai tab của reputation-feedback); Turso không bị.
    mocks.bot.mockResolvedValue({ ok: true });
    const venue = await newVenue();
    const m = await player(venue, 3);
    asMember(m);
    const [a, b] = await Promise.all([
      submitVenueReview(payload(venue.id, { comment: "Tab 1" })),
      submitVenueReview(
        payload(venue.id, {
          comment: "Tab 2",
          scores: { ...SCORES, surface: 1 },
        }),
      ),
    ]);
    const rows = await testDb
      .select()
      .from(venueReviews)
      .where(eq(venueReviews.venueId, venue.id));
    expect(rows).toHaveLength(1);
    expect(a).toEqual({
      success: true,
      data: { id: rows[0].id, status: "visible" },
    });
    expect(b).toEqual(a);
    expect(rows[0].editedAt).toBeNull();
    expect(rows[0].comment).toBe("Tab 2");

    // Sau 1 phút thì đã là một lần sửa.
    vi.setSystemTime(NOW + MIN);
    await submitVenueReview(payload(venue.id, { comment: "Sửa" }));
    expect((await rowOf(venue.id, m.id)).editedAt).toBe(iso(NOW + MIN));
  });

  it("a hidden review cannot be edited; held-for-contact edited clean turns visible; held-for-anomaly stays held", async () => {
    const venue = await newVenue();
    const old = iso(NOW - 40 * DAY);
    const hiddenBy = await player(venue, 5);
    const hidden = await seedReview(venue, hiddenBy, {
      status: "hidden",
      reportCount: 3,
      createdAt: old,
    });
    expect(await submitAs(hiddenBy, venue.id)).toEqual({
      error: "reviewHidden",
    });
    expect(await rowOf(venue.id, hiddenBy.id)).toEqual(hidden);

    const contactBy = await player(venue, 5);
    await seedReview(venue, contactBy, {
      status: "held",
      holdReason: "contact",
      comment: "0912 345 678",
      reportCount: 1,
      createdAt: old,
    });
    expect(
      await submitAs(contactBy, venue.id, { comment: "Sân tốt" }),
    ).toMatchObject({ data: { status: "visible" } });
    let row = await rowOf(venue.id, contactBy.id);
    expect(row).toMatchObject({
      status: "visible",
      holdReason: null,
      comment: "Sân tốt",
      reportCount: 1,
      createdAt: old,
    });

    const anomalyBy = await player(venue, 5);
    await seedReview(venue, anomalyBy, {
      status: "held",
      holdReason: "anomaly",
      createdAt: old,
    });
    expect(
      await submitAs(anomalyBy, venue.id, { comment: "Sân tốt" }),
    ).toMatchObject({ data: { status: "held" } });
    row = await rowOf(venue.id, anomalyBy.id);
    expect(row).toMatchObject({ status: "held", holdReason: "anomaly" });
  });

  it("a review held for anomaly stays held through an edit with a phone and a clean edit after it", async () => {
    const venue = await newVenue();
    for (let i = 0; i < 4; i += 1)
      await seedReview(venue, await player(venue, 5), {
        createdAt: iso(NOW - (i + 1) * HOUR),
      });
    const by = await player(venue, 5);
    expect(await submitAs(by, venue.id)).toMatchObject({
      data: { status: "held" },
    });
    const held = { status: "held", holdReason: "anomaly" };
    expect(await rowOf(venue.id, by.id)).toMatchObject(held);

    // Gửi lại trong 1 phút (nhánh hai tab, không thành lần sửa).
    vi.setSystemTime(NOW + 10_000);
    expect(
      await submitAs(by, venue.id, { comment: "goi 0912 345 678" }),
    ).toMatchObject({ data: { status: "held" } });
    expect(await rowOf(venue.id, by.id)).toMatchObject({
      ...held,
      editedAt: null,
    });
    vi.setSystemTime(NOW + 20_000);
    expect(await submitAs(by, venue.id, { comment: "Sân tốt" })).toMatchObject({
      data: { status: "held" },
    });
    expect(await rowOf(venue.id, by.id)).toMatchObject({
      ...held,
      comment: "Sân tốt",
    });

    // Qua hai lần sửa cách nhau 30 ngày cũng vậy.
    vi.setSystemTime(NOW + 31 * DAY);
    expect(
      await submitAs(by, venue.id, { comment: "zalo.me/x" }),
    ).toMatchObject({ data: { status: "held" } });
    expect(await rowOf(venue.id, by.id)).toMatchObject(held);
    vi.setSystemTime(NOW + 62 * DAY);
    expect(await submitAs(by, venue.id, { comment: "Sân ổn" })).toMatchObject({
      data: { status: "held" },
    });
    expect(await rowOf(venue.id, by.id)).toMatchObject(held);
  });

  it("updateTag gets vrev:v{id} only", async () => {
    await enableNotificationsForTest(testDb);
    const venue = await newVenue();
    await submitAs(await player(venue), venue.id);
    await submitAs(await player(venue), venue.id, { comment: "0912 345 678" });
    expect(mocks.updateTag.mock.calls).toEqual([
      [`vrev:v${venue.id}`],
      [`vrev:v${venue.id}`],
    ]);
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("getMyVenueReview", () => {
  it("getMyVenueReview returns eligibility, id, month and nextEditAt", async () => {
    const venue = await newVenue();
    const stranger = await newMember();
    asMember(stranger);
    expect(await getMyVenueReview(venue.id)).toEqual({
      success: true,
      data: { eligible: false, review: null, nextEditAt: null },
    });

    const m = await player(venue);
    asMember(m);
    expect(await getMyVenueReview(venue.id)).toEqual({
      success: true,
      data: { eligible: true, review: null, nextEditAt: null },
    });

    // 2026-10-31T18:00Z là 01:00 ngày 01/11 giờ VN: tháng theo giờ VN.
    const created = Date.parse("2026-10-31T18:00:00.000Z");
    vi.setSystemTime(created);
    await submitAs(m, venue.id, { comment: "Ổn" });
    const row = await rowOf(venue.id, m.id);
    const view = await getMyVenueReview(venue.id);
    expect(view).toEqual({
      success: true,
      data: {
        eligible: true,
        review: {
          id: row.id,
          scores: SCORES,
          comment: "Ổn",
          status: "visible",
          holdReason: null,
          month: "2026-11",
          editedAt: null,
        },
        // Lần sửa đầu làm được ngay.
        nextEditAt: null,
      },
    });

    vi.setSystemTime(created + 10 * MIN);
    await submitAs(m, venue.id, { comment: "Ổn hơn" });
    const after = await getMyVenueReview(venue.id);
    expect(after).toMatchObject({
      data: {
        review: { editedAt: iso(created + 10 * MIN), month: "2026-11" },
        nextEditAt: iso(created + 10 * MIN + 30 * DAY),
      },
    });

    // Đã qua 30 ngày: sửa được, không còn mốc chờ.
    vi.setSystemTime(created + 10 * MIN + 30 * DAY);
    expect(await getMyVenueReview(venue.id)).toMatchObject({
      data: { nextEditAt: null },
    });
  });

  it("getMyVenueReview: flag, account and venue guards; no write", async () => {
    const venue = await newVenue();
    const m = await player(venue);
    mocks.flag.mockResolvedValue(false);
    asMember(m);
    expect(await getMyVenueReview(venue.id)).toEqual({ error: "notFound" });
    expect(mocks.auth).not.toHaveBeenCalled();

    mocks.flag.mockResolvedValue(true);
    mocks.auth.mockResolvedValue({
      error: "Vui lòng xác nhận danh tính trước",
    });
    expect(await getMyVenueReview(venue.id)).toEqual({
      error: "Vui lòng xác nhận danh tính trước",
    });

    asMember(m);
    expect(await getMyVenueReview(-1)).toEqual({ error: "invalidInput" });
    const hidden = await newVenue("hidden");
    expect(await getMyVenueReview(hidden.id)).toEqual({
      error: "reviewVenueNotFound",
    });
    expect(await testDb.select().from(rateLimitBuckets)).toHaveLength(0);
  });
});

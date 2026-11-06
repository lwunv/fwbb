import { describe, it, expect, beforeEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import {
  exchangeCommentReads,
  exchangeComments,
  exchangeEvents,
  exchangeRegistrations,
  hostBlocks,
  members,
  venues,
} from "@/db/schema";

const mocks = vi.hoisted(() => ({ flag: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/exchange-flag", () => ({ isExchangeEnabled: mocks.flag }));
vi.mock("@/lib/member-auth", () => ({
  requireExchangeMember: mocks.auth,
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { getMyExchanges } = await import("./exchange-mine");
const { newCommentsSince, newCommentsQuery } =
  await import("@/lib/exchange/comment-reads");

const NOW = "2026-11-05T00:00:00.000Z";
const day = (d: string, h: number) =>
  `${d}T${String(h).padStart(2, "0")}:00:00.000Z`;

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
const me = await seedMember("Me", {
  approvalStatus: "pending",
  signupIntent: "exchange",
});
const other = await seedMember("Other");

let seq = 0;
async function seedEvent(o: Partial<typeof exchangeEvents.$inferInsert> = {}) {
  seq += 1;
  const [e] = await testDb
    .insert(exchangeEvents)
    .values({
      publicCode: `mine${String(seq).padStart(6, "0")}`,
      hostMemberId: host.id,
      venueId: venue.id,
      title: `t${seq}`,
      startAt: day("2099-06-01", 12),
      endAt: day("2099-06-01", 14),
      slotsTotal: 10,
      feeMode: "fixed",
      feeAmountMale: 50_000,
      registerDeadline: day("2099-06-01", 10),
      cancelDeadline: day("2099-06-01", 10),
      createdAt: NOW,
      updatedAt: NOW,
      ...o,
    })
    .returning();
  return e;
}
async function seedReg(
  eventId: number,
  memberId: number,
  o: Partial<typeof exchangeRegistrations.$inferInsert> = {},
) {
  await testDb.insert(exchangeRegistrations).values({
    eventId,
    memberId,
    status: "approved",
    maleCount: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...o,
  });
}

beforeEach(async () => {
  await testDb.delete(exchangeCommentReads);
  await testDb.delete(exchangeComments);
  await testDb.delete(hostBlocks);
  await testDb.delete(exchangeRegistrations);
  await testDb.delete(exchangeEvents);
  mocks.flag.mockResolvedValue(true);
  mocks.auth.mockResolvedValue({
    user: { memberId: me.id, externalId: "x" },
    member: me,
  });
});

describe("getMyExchanges", () => {
  it("my exchanges lists my registrations and hosted events; a rejected account gets an error", async () => {
    const later = await seedEvent({
      startAt: day("2099-07-01", 12),
      endAt: day("2099-07-01", 14),
    });
    const sooner = await seedEvent();
    const past = await seedEvent({
      startAt: day("2020-01-01", 12),
      endAt: day("2020-01-01", 14),
      status: "done",
    });
    const notMine = await seedEvent();
    await seedReg(later.id, me.id, { status: "pending", depositPaid: true });
    await seedReg(sooner.id, me.id, {
      status: "approved",
      feeAmount: 60_000,
      paid: true,
      paidAmount: 80_000,
      maleCount: 1,
    });
    await seedReg(past.id, me.id);
    await seedReg(notMine.id, other.id);
    await testDb.insert(hostBlocks).values({
      hostMemberId: me.id,
      blockedMemberId: other.id,
      createdAt: NOW,
    });

    const r = await getMyExchanges();
    if ("error" in r) throw new Error(r.error);
    // Sắp diễn ra trước (gần giờ nhất trước), buổi đã qua xuống cuối.
    expect(r.registrations.map((x) => x.code)).toEqual([
      sooner.publicCode,
      later.publicCode,
      past.publicCode,
    ]);
    const first = r.registrations[0];
    expect(first.myStatus).toBe("approved");
    // Không có vị trí người xem nên không có khoảng cách (không hiện "0,0 km").
    expect(first.distanceM).toBeNull();
    expect(first.feeAmount).toBe(60_000);
    expect(first.paid).toBe(true);
    // Đã trả 80K cho phí chốt 60K: host phải hoàn 20K, không còn thiếu.
    expect(first.remaining).toBe(0);
    expect(first.refundDue).toBe(20_000);
    expect(r.registrations[1].myStatus).toBe("pending");
    expect(r.hosting).toEqual([]);
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]).toEqual({ id: expect.any(Number), name: "Other" });

    // Host thấy buổi mình mở.
    mocks.auth.mockResolvedValue({
      user: { memberId: host.id, externalId: "x" },
      member: host,
    });
    const h = await getMyExchanges();
    if ("error" in h) throw new Error(h.error);
    expect(h.hosting.map((x) => x.code).sort()).toEqual(
      [later, sooner, past, notMine].map((e) => e.publicCode).sort(),
    );
    expect(h.registrations).toEqual([]);
    expect(h.blocks).toEqual([]);

    // Tài khoản bị từ chối nhận lỗi.
    mocks.auth.mockResolvedValue({ error: "Tài khoản đã bị từ chối." });
    expect(await getMyExchanges()).toEqual({
      error: "Tài khoản đã bị từ chối.",
    });
  });

  it("my exchanges returns an error when the flag is off", async () => {
    mocks.flag.mockResolvedValue(false);
    const r = await getMyExchanges();
    expect("error" in r).toBe(true);
  });
});

describe("getMyExchanges: new comments", () => {
  async function seedComment(
    eventId: number,
    authorMemberId: number,
    createdAt: string,
    o: Partial<typeof exchangeComments.$inferInsert> = {},
  ) {
    await testDb.insert(exchangeComments).values({
      eventId,
      authorMemberId,
      channel: "qa",
      body: "x",
      status: "visible",
      createdAt,
      ...o,
    });
  }

  it("my exchanges counts new comments per readable channel since last read; events older than 14 days count 0 without a query", async () => {
    const ev1 = await seedEvent();
    const ev2 = await seedEvent();
    const old = await seedEvent({
      startAt: day("2020-01-01", 12),
      endAt: day("2020-01-01", 14),
      status: "done",
    });
    const cancelledLongAgo = await seedEvent({
      cancelledAt: day("2020-01-02", 0),
      status: "cancelled",
    });
    // ev1: đăng ký pending chỉ đọc được Hỏi đáp.
    await seedReg(ev1.id, me.id, { status: "pending" });
    await seedComment(ev1.id, other.id, day("2026-11-01", 1));
    await seedComment(ev1.id, other.id, day("2026-11-01", 2));
    await seedComment(ev1.id, me.id, day("2026-11-01", 3));
    await seedComment(ev1.id, other.id, day("2026-11-01", 4), {
      status: "held",
    });
    await seedComment(ev1.id, other.id, day("2026-11-01", 5), {
      status: "deleted",
    });
    for (const h of [6, 7, 8])
      await seedComment(ev1.id, host.id, day("2026-11-01", h), {
        channel: "group",
      });
    // ev2: approved, đã đọc Hỏi đáp và Nhóm buổi tới 03:00.
    await seedReg(ev2.id, me.id, { status: "approved" });
    await seedComment(ev2.id, other.id, day("2026-11-01", 1));
    await seedComment(ev2.id, host.id, day("2026-11-01", 2), {
      channel: "group",
    });
    await seedComment(ev2.id, host.id, day("2026-11-01", 5), {
      channel: "group",
    });
    await testDb.insert(exchangeCommentReads).values({
      eventId: ev2.id,
      memberId: me.id,
      lastReadAt: day("2026-11-01", 3),
      lastReadGroupAt: day("2026-11-01", 3),
    });
    await seedReg(old.id, me.id);
    await seedComment(old.id, other.id, day("2026-11-01", 1));
    await seedReg(cancelledLongAgo.id, me.id);
    await seedComment(cancelledLongAgo.id, other.id, day("2026-11-01", 1));

    const r = await getMyExchanges();
    if ("error" in r) throw new Error(r.error);
    const byCode = new Map(r.registrations.map((x) => [x.code, x.newComments]));
    expect(byCode.get(ev1.publicCode)).toBe(2);
    expect(byCode.get(ev2.publicCode)).toBe(1);
    expect(byCode.get(old.publicCode)).toBe(0);
    expect(byCode.get(cancelledLongAgo.publicCode)).toBe(0);

    // Host: cả hai khu, không tính bình luận của chính mình.
    mocks.auth.mockResolvedValue({
      user: { memberId: host.id, externalId: "x" },
      member: host,
    });
    const h = await getMyExchanges();
    if ("error" in h) throw new Error(h.error);
    const hostCounts = new Map(h.hosting.map((x) => [x.code, x.newComments]));
    expect(hostCounts.get(ev1.publicCode)).toBe(3);
    expect(hostCounts.get(ev2.publicCode)).toBe(1);
    expect(hostCounts.get(old.publicCode)).toBe(0);

    // Buổi ngoài cửa sổ 14 ngày: trả 0 mà không chạm DB.
    const exec = vi.spyOn(client, "execute");
    try {
      const counts = await newCommentsSince(
        testDb,
        me.id,
        [
          {
            id: old.id,
            groupAccess: true,
            endAt: old.endAt,
            cancelledAt: null,
          },
          {
            id: cancelledLongAgo.id,
            groupAccess: true,
            endAt: cancelledLongAgo.endAt,
            cancelledAt: cancelledLongAgo.cancelledAt,
          },
        ],
        new Date(),
      );
      expect(counts).toEqual([
        [old.id, 0],
        [cancelledLongAgo.id, 0],
      ]);
      expect(exec).not.toHaveBeenCalled();
    } finally {
      exec.mockRestore();
    }
  });

  it("EXPLAIN QUERY PLAN of the count has no SCAN exchange_comments", async () => {
    const ev1 = await seedEvent();
    const ev2 = await seedEvent();
    const plan = await testDb.all<{ detail: string }>(
      sql`EXPLAIN QUERY PLAN ${newCommentsQuery(me.id, [ev1.id, ev2.id], [ev1.id])}`,
    );
    const details = plan.map((p) => p.detail);
    expect(details.some((d) => /SCAN exchange_comments/.test(d))).toBe(false);
    expect(
      details.filter((d) =>
        d.includes("exchange_comments_event_channel_created_idx"),
      ),
    ).toHaveLength(2);
  });
});

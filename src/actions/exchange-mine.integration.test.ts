import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
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

const { db: testDb } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { getMyExchanges } = await import("./exchange-mine");

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

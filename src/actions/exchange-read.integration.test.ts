import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  exchangeEvents,
  exchangeRegistrations,
  members,
  referrals,
  venues,
} from "@/db/schema";
import { eq } from "drizzle-orm";

const mocks = vi.hoisted(() => ({ flag: vi.fn(), viewer: vi.fn() }));
vi.mock("@/lib/exchange-flag", () => ({ isExchangeEnabled: mocks.flag }));
vi.mock("@/lib/member-auth", () => ({ getExchangeViewer: mocks.viewer }));
// Serialises like the real Data Cache (JSON.stringify), so a Map/Date/Set in a
// cached value shows up as a failure instead of passing through untouched.
vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache:
    <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
    async (...a: A): Promise<R> => {
      const out = await fn(...a);
      const text = JSON.stringify(out);
      return text === undefined ? (undefined as R) : (JSON.parse(text) as R);
    },
}));

const { db: testDb } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const {
  getExchangeEvent,
  listExchangesNear,
  listUpcomingAtVenue,
  countUpcomingByVenue,
} = await import("./exchange-read");

const NOW = "2026-11-05T00:00:00.000Z";
const FUTURE_DAY = "2099-06-01";
const at = (h: number, m = 0) =>
  `${FUTURE_DAY}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;

const [venue] = await testDb
  .insert(venues)
  .values({ name: "Near", lat: 10, lng: 106, status: "approved" })
  .returning();
const [farVenue] = await testDb
  .insert(venues)
  .values({ name: "Far", lat: 12, lng: 106, status: "approved" })
  .returning();
const [pendingVenue] = await testDb
  .insert(venues)
  .values({ name: "Pending", lat: 10, lng: 106, status: "pending" })
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
const alice = await seedMember("Alice");
const stranger = await seedMember("Stranger", { approvalStatus: "pending" });

let seq = 0;
async function seedEvent(o: Partial<typeof exchangeEvents.$inferInsert> = {}) {
  seq += 1;
  const [e] = await testDb
    .insert(exchangeEvents)
    .values({
      publicCode: `ev${String(seq).padStart(6, "0")}`,
      hostMemberId: host.id,
      venueId: venue.id,
      title: `t${seq}`,
      startAt: at(12),
      endAt: at(14),
      slotsTotal: 10,
      feeMode: "fixed",
      feeAmountMale: 50_000,
      registerDeadline: at(10),
      cancelDeadline: at(10),
      hostContact: "0912345678",
      zaloGroupLink: "https://zalo.me/g/secret",
      payoutBankBin: "970436",
      payoutAccountNo: "111222333",
      payoutAccountName: "HOST",
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
function asViewer(m: typeof host | null) {
  mocks.viewer.mockResolvedValue(
    m
      ? {
          status: "ok",
          user: { memberId: m.id, externalId: "x" },
          member: m,
          isGroupMember: m.approvalStatus === "approved",
        }
      : { status: "anonymous" },
  );
}
const NEAR = { lat: 10, lng: 106, radiusKm: 5 as const };
async function near(q: Partial<Parameters<typeof listExchangesNear>[0]> = {}) {
  const r = await listExchangesNear({ ...NEAR, ...q });
  if ("error" in r) throw new Error(r.error);
  return r.events;
}

beforeEach(async () => {
  await testDb.delete(exchangeRegistrations);
  await testDb.delete(exchangeEvents);
  await testDb
    .update(members)
    .set({ isActive: true, approvalStatus: "approved" })
    .where(eq(members.id, host.id));
  mocks.flag.mockReset().mockResolvedValue(true);
  asViewer(null);
});

describe("getExchangeEvent", () => {
  it("guest gets no contact, link, payout or names", async () => {
    const e = await seedEvent({ depositAmount: 20_000 });
    await seedReg(e.id, alice.id);
    const r = await getExchangeEvent(e.publicCode);
    expect(r?.viewer).toMatchObject({
      role: "guest",
      hostContact: null,
      zaloGroupLink: null,
      payout: null,
      attendees: null,
      myRegistration: null,
    });
    const json = JSON.stringify(r);
    expect(json).not.toContain("0912345678");
    expect(json).not.toContain("zalo.me");
    expect(json).not.toContain("111222333");
    expect(json).not.toContain("Alice");
  });

  it("approved registrant sees contact, payout and attendee names; pending without deposit does not", async () => {
    const e = await seedEvent({ status: "locked", depositAmount: 0 });
    await seedReg(e.id, alice.id, { feeAmount: 50_000 });
    asViewer(alice);
    const r = await getExchangeEvent(e.publicCode);
    expect(r?.viewer.role).toBe("member");
    expect(r?.viewer.hostContact).toBe("0912345678");
    expect(r?.viewer.zaloGroupLink).toBe("https://zalo.me/g/secret");
    expect(r?.viewer.payout).toEqual({
      bankBin: "970436",
      accountNo: "111222333",
      accountName: "HOST",
    });
    expect(r?.viewer.attendees?.map((a) => a.name)).toEqual(["Alice"]);
    expect(r?.viewer.myRegistration).toMatchObject({
      status: "approved",
      remaining: 50_000,
      refundDue: 0,
    });

    const open = await seedEvent({ depositAmount: 0 });
    await seedReg(open.id, stranger.id, { status: "pending" });
    asViewer(stranger);
    const p = await getExchangeEvent(open.publicCode);
    expect(p?.viewer).toMatchObject({
      hostContact: null,
      zaloGroupLink: null,
      payout: null,
      attendees: null,
    });
    expect(p?.viewer.myRegistration?.status).toBe("pending");

    // Pending on an event that asks for a deposit sees where to pay it.
    const dep = await seedEvent({ depositAmount: 30_000 });
    await seedReg(dep.id, stranger.id, { status: "pending" });
    const d = await getExchangeEvent(dep.publicCode);
    expect(d?.viewer.payout?.accountNo).toBe("111222333");
    expect(d?.viewer.hostContact).toBeNull();
  });

  it("guest JSON has no attendee code; an approved registrant gets attendee codes", async () => {
    await testDb
      .update(members)
      .set({ publicCode: "hostcode22" })
      .where(eq(members.id, host.id));
    const coded = await seedMember("Coded", { publicCode: "attcode234" });
    const plain = await seedMember("Plain");
    const e = await seedEvent();
    await seedReg(e.id, coded.id);
    await seedReg(e.id, plain.id);

    const g = await getExchangeEvent(e.publicCode);
    expect(g?.event.host.code).toBe("hostcode22");
    expect(g?.viewer.attendees).toBeNull();
    expect(JSON.stringify(g)).not.toContain("attcode234");

    asViewer(coded);
    const r = await getExchangeEvent(e.publicCode);
    expect(r?.viewer.attendees?.map((a) => [a.name, a.code])).toEqual([
      ["Coded", "attcode234"],
      ["Plain", null],
    ]);
    expect(r?.event.host.code).toBe("hostcode22");
  });

  it("a host without a code is shown with code null", async () => {
    await testDb
      .update(members)
      .set({ publicCode: null })
      .where(eq(members.id, host.id));
    const e = await seedEvent();
    const r = await getExchangeEvent(e.publicCode);
    expect(r?.event.host).toHaveProperty("code", null);
  });

  it("payout stays visible on a done event while the member still owes, and goes away once paid", async () => {
    const e = await seedEvent({ status: "done", depositAmount: 20_000 });
    await seedReg(e.id, alice.id, { feeAmount: 50_000, depositPaid: true });
    asViewer(alice);
    const owing = await getExchangeEvent(e.publicCode);
    expect(owing?.viewer.payout?.accountNo).toBe("111222333");
    expect(owing?.viewer.myRegistration?.remaining).toBe(30_000);

    await testDb
      .update(exchangeRegistrations)
      .set({ paid: true })
      .where(eq(exchangeRegistrations.eventId, e.id));
    const paid = await getExchangeEvent(e.publicCode);
    expect(paid?.viewer.payout).toBeNull();
  });

  it("a paid member who owes the difference after a relock up sees payout and the same remaining as the notice", async () => {
    // Fee 120K, deposit 30K, paid 100K: 20K still to pay, nothing to refund.
    const e = await seedEvent({ status: "locked", depositAmount: 30_000 });
    await seedReg(e.id, alice.id, {
      feeAmount: 120_000,
      depositPaid: true,
      paid: true,
      paidAmount: 100_000,
    });
    asViewer(alice);
    const r = await getExchangeEvent(e.publicCode);
    expect(r?.viewer.myRegistration).toMatchObject({
      remaining: 20_000,
      refundDue: 0,
    });
    expect(r?.viewer.payout?.accountNo).toBe("111222333");
  });

  it("a paid member relocked down sees refundDue 20K and no payout", async () => {
    const e = await seedEvent({ status: "locked", depositAmount: 30_000 });
    await seedReg(e.id, alice.id, {
      feeAmount: 80_000,
      depositPaid: true,
      paid: true,
      paidAmount: 100_000,
    });
    asViewer(alice);
    const r = await getExchangeEvent(e.publicCode);
    expect(r?.viewer.myRegistration).toMatchObject({
      remaining: 0,
      refundDue: 20_000,
    });
    expect(r?.viewer.payout).toBeNull();
  });

  it("a cancelled event shows the deposit as refundDue, not the stored fee as owed", async () => {
    const e = await seedEvent({ status: "cancelled", depositAmount: 20_000 });
    await seedReg(e.id, alice.id, { feeAmount: 50_000, depositPaid: true });
    asViewer(alice);
    const r = await getExchangeEvent(e.publicCode);
    expect(r?.viewer.myRegistration).toMatchObject({
      remaining: 0,
      refundDue: 20_000,
    });
  });

  it("a charged late canceller or no-show gets payout and host contact, a plain canceller does not (R26)", async () => {
    // Locked at 100K, then cancelled late: still owes the full 100K.
    const e = await seedEvent({ status: "locked" });
    await seedReg(e.id, alice.id, {
      status: "late_cancelled",
      feeAmount: 100_000,
    });
    asViewer(alice);
    const late = await getExchangeEvent(e.publicCode);
    expect(late?.viewer.myRegistration?.remaining).toBe(100_000);
    expect(late?.viewer.payout?.accountNo).toBe("111222333");
    expect(late?.viewer.hostContact).toBe("0912345678");
    // Group link and names stay for approved players only.
    expect(late?.viewer.zaloGroupLink).toBeNull();
    expect(late?.viewer.attendees).toBeNull();

    const done = await seedEvent({ status: "done" });
    await seedReg(done.id, alice.id, { status: "no_show", feeAmount: 100_000 });
    const noShow = await getExchangeEvent(done.publicCode);
    expect(noShow?.viewer.payout?.accountNo).toBe("111222333");
    expect(noShow?.viewer.hostContact).toBe("0912345678");

    // A plain cancel is not charged: no payout, no contact.
    const plain = await seedEvent({ status: "locked" });
    await seedReg(plain.id, alice.id, {
      status: "cancelled",
      feeAmount: 100_000,
    });
    const cancelled = await getExchangeEvent(plain.publicCode);
    expect(cancelled?.viewer.myRegistration?.remaining).toBe(0);
    expect(cancelled?.viewer.payout).toBeNull();
    expect(cancelled?.viewer.hostContact).toBeNull();
  });

  it("someone owed a refund sees the host contact but no payout", async () => {
    const e = await seedEvent({ status: "cancelled", depositAmount: 20_000 });
    await seedReg(e.id, alice.id, { status: "cancelled", depositPaid: true });
    asViewer(alice);
    const r = await getExchangeEvent(e.publicCode);
    expect(r?.viewer.myRegistration?.refundDue).toBe(20_000);
    expect(r?.viewer.hostContact).toBe("0912345678");
    expect(r?.viewer.payout).toBeNull();
  });

  it("hidden event null for a stranger, visible to its host", async () => {
    const e = await seedEvent({ hiddenAt: NOW });
    expect(await getExchangeEvent(e.publicCode)).toBeNull();
    asViewer(alice);
    expect(await getExchangeEvent(e.publicCode)).toBeNull();
    asViewer(host);
    const r = await getExchangeEvent(e.publicCode);
    expect(r?.event.hidden).toBe(true);
    expect(r?.viewer.role).toBe("host");
    expect(r?.viewer.hostContact).toBe("0912345678");
    // Someone who already registered keeps access.
    await seedReg(e.id, alice.id);
    asViewer(alice);
    expect(await getExchangeEvent(e.publicCode)).not.toBeNull();
  });

  it("events of a deactivated host are not listed and getExchangeEvent returns null for a stranger", async () => {
    const e = await seedEvent();
    expect(await near()).toHaveLength(1);
    await testDb
      .update(members)
      .set({ isActive: false })
      .where(eq(members.id, host.id));
    expect(await near()).toHaveLength(0);
    expect(await listUpcomingAtVenue(venue.id)).toHaveLength(0);
    expect(await countUpcomingByVenue([venue.id])).toEqual([]);
    expect(await getExchangeEvent(e.publicCode)).toBeNull();
    asViewer(host);
    expect(await getExchangeEvent(e.publicCode)).not.toBeNull();
  });

  it("returns null when the flag is off or the code is junk", async () => {
    const e = await seedEvent();
    expect(await getExchangeEvent("x; DROP")).toBeNull();
    expect(await getExchangeEvent("nope1234")).toBeNull();
    mocks.flag.mockResolvedValue(false);
    expect(await getExchangeEvent(e.publicCode)).toBeNull();
  });

  it("warns a member outside the skill range and flags a new account", async () => {
    const e = await seedEvent({ skillMin: "tb", skillMax: "tbk" });
    const low = await seedMember("Low", {
      skillLevel: "yeu",
      approvalStatus: "pending",
    });
    asViewer(low);
    const r = await getExchangeEvent(e.publicCode);
    expect(r?.viewer.skillWarning).toBe("below");
    expect(r?.viewer.isNewAccount).toBe(true);
    asViewer(alice);
    expect((await getExchangeEvent(e.publicCode))?.viewer.isNewAccount).toBe(
      false,
    );
  });

  it("viewer.isNewAccount is false for a referred account", async () => {
    const e = await seedEvent();
    const fresh = await seedMember("Fresh", { approvalStatus: "pending" });
    asViewer(fresh);
    expect((await getExchangeEvent(e.publicCode))?.viewer.isNewAccount).toBe(
      true,
    );
    await testDb.insert(referrals).values({
      referrerMemberId: alice.id,
      refereeMemberId: fresh.id,
      createdAt: NOW,
    });
    expect((await getExchangeEvent(e.publicCode))?.viewer.isNewAccount).toBe(
      false,
    );
  });
});

describe("listExchangesNear", () => {
  it("listExchangesNear excludes cancelled, locked, hidden, past and out-of-radius events, sorts nearest, caps at 50", async () => {
    await seedEvent({ status: "cancelled" });
    await seedEvent({ status: "locked" });
    await seedEvent({ hiddenAt: NOW });
    await seedEvent({ startAt: "2020-01-01T10:00:00.000Z" });
    await seedEvent({ venueId: farVenue.id });
    await seedEvent({ venueId: pendingVenue.id });
    expect(await near()).toHaveLength(0);

    const full = await seedEvent({ status: "full" });
    const ok = await seedEvent({ startAt: at(1) });
    const list = await near();
    expect(list.map((c) => c.code).sort()).toEqual(
      [full.publicCode, ok.publicCode].sort(),
    );
    // Same venue: the earlier start comes first.
    expect(list[0].code).toBe(ok.publicCode);

    // A farther venue with an earlier start must not outrank the nearer one.
    const [farther] = await testDb
      .insert(venues)
      .values({ name: "Farther", lat: 10.01, lng: 106, status: "approved" })
      .returning();
    const earlier = await seedEvent({ venueId: farther.id, startAt: at(0) });
    const list2 = await near();
    expect(list2[list2.length - 1].code).toBe(earlier.publicCode);

    for (let i = 0; i < 60; i += 1) await seedEvent();
    expect(await near()).toHaveLength(50);
  });

  it("60 events in the box: the nearest and the only filter match are still returned", async () => {
    const [inner] = await testDb
      .insert(venues)
      .values({ name: "Inner", lat: 10.0005, lng: 106, status: "approved" })
      .returning();
    const nearest = await seedEvent({ startAt: at(1) });
    for (let i = 0; i < 60; i += 1) await seedEvent({ skillMin: "tbk" });
    const match = await seedEvent({
      venueId: inner.id,
      skillMin: "yeu",
      skillMax: "yeu",
    });
    const list = await near({ skill: "yeu" });
    expect(list.map((c) => c.code)).toEqual([
      nearest.publicCode,
      match.publicCode,
    ]);
    expect((await near())[0].code).toBe(nearest.publicCode);
  });

  it("evening filter keeps a 19:00 VN event under TZ=UTC", async () => {
    const evening = await seedEvent({ startAt: at(12) }); // 19:00 VN
    await seedEvent({ startAt: at(2) }); // 09:00 VN
    await seedEvent({ startAt: at(7) }); // 14:00 VN
    expect((await near({ timeOfDay: "evening" })).map((c) => c.code)).toEqual([
      evening.publicCode,
    ]);
    expect(await near({ timeOfDay: "morning" })).toHaveLength(1);
    expect(await near({ timeOfDay: "afternoon" })).toHaveLength(1);
  });

  it("date filters on the Vietnam calendar day, not the UTC day", async () => {
    // 2099-06-01T18:00Z is 01:00 on June 2 in Vietnam.
    const lateNight = await seedEvent({ startAt: at(18) });
    const sameDay = await seedEvent({ startAt: at(5) });
    const day1 = await near({ date: "2099-06-01" });
    expect(day1.map((c) => c.code)).toEqual([sameDay.publicCode]);
    const day2 = await near({ date: "2099-06-02" });
    expect(day2.map((c) => c.code)).toEqual([lateNight.publicCode]);
  });

  it("hasFemaleSlot keeps an event with only female-reserved slots free", async () => {
    const e = await seedEvent({ slotsTotal: 4, femaleReservedSlots: 2 });
    await seedReg(e.id, alice.id, { maleCount: 2 });
    const [card] = await near();
    expect(card.counts.freeTotal).toBe(2);
    expect(card.counts.freeFemaleOnly).toBe(2);
    expect(await near({ hasFemaleSlot: true })).toHaveLength(1);
    expect(await near({ hasSlot: true })).toHaveLength(0);
  });

  it("maxFee compares with the fixed fee or the split estimate", async () => {
    await seedEvent({ feeAmountMale: 80_000 });
    const split = await seedEvent({
      feeMode: "split_equal",
      feeAmountMale: null,
      estimatedTotalCost: 400_000,
      minHeads: 3,
    });
    // Estimate: 400k / (3 + 1 host) = 100k.
    expect((await near({ maxFee: 90_000 })).map((c) => c.fee.kind)).toEqual([
      "fixed",
    ]);
    const all = await near({ maxFee: 100_000 });
    expect(all.map((c) => c.code)).toContain(split.publicCode);
  });

  it("an impossible date is a clean error, not a crash inside the cache", async () => {
    await seedEvent();
    for (const date of ["2026-13-45", "2026-02-31"])
      expect(await listExchangesNear({ ...NEAR, date })).toEqual({
        error: "invalidSearch",
      });
  });

  it("rejects a bad radius or coordinates and respects the flag", async () => {
    expect(
      "error" in (await listExchangesNear({ ...NEAR, radiusKm: 7 as never })),
    ).toBe(true);
    expect("error" in (await listExchangesNear({ ...NEAR, lat: 999 }))).toBe(
      true,
    );
    mocks.flag.mockResolvedValue(false);
    expect("error" in (await listExchangesNear(NEAR))).toBe(true);
  });
});

describe("per-venue reads", () => {
  it("listUpcomingAtVenue lists open events of an approved venue, earliest first", async () => {
    const late = await seedEvent({ startAt: at(15) });
    const early = await seedEvent({ startAt: at(3) });
    await seedEvent({ status: "cancelled" });
    await seedEvent({ venueId: farVenue.id });
    const list = await listUpcomingAtVenue(venue.id);
    expect(list.map((c) => c.code)).toEqual([
      early.publicCode,
      late.publicCode,
    ]);
    expect(await listUpcomingAtVenue(-1)).toEqual([]);
  });

  it("countUpcomingByVenue survives a JSON round trip of the cache", async () => {
    await seedEvent();
    await seedEvent();
    await seedEvent({ venueId: farVenue.id });
    await seedEvent({ hiddenAt: NOW });
    const rows = await countUpcomingByVenue([farVenue.id, venue.id, venue.id]);
    expect(Array.isArray(rows)).toBe(true);
    expect(new Map(rows)).toEqual(
      new Map([
        [venue.id, 2],
        [farVenue.id, 1],
      ]),
    );
    expect(await countUpcomingByVenue([])).toEqual([]);
    mocks.flag.mockResolvedValue(false);
    expect(await countUpcomingByVenue([venue.id])).toEqual([]);
  });
});

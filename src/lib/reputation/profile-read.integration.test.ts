import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import {
  venues,
  exchangeEvents,
  exchangeRegistrations,
  members,
  peerFeedback,
  hostFeedback,
} from "@/db/schema";
import type {
  ExchangeEventStatus,
  ExchangeRegStatus,
} from "@/lib/exchange/constants";
import type { SkillLevel } from "@/lib/skill-level";
import type { CacheStore } from "@/test-utils/next-cache-store";

const mocks = vi.hoisted(() => ({ flag: vi.fn(async () => true) }));
vi.mock("@/lib/exchange-flag", () => ({ isExchangeEnabled: mocks.flag }));
vi.mock("next/cache", async () =>
  (await import("@/test-utils/next-cache-store")).createCacheStore(),
);

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const cache = (await import("next/cache")) as unknown as CacheStore;
const {
  attendanceSummaries,
  attendanceQuery,
  loadReputation,
  peerRowsQuery,
  hostRowsQuery,
  hostCountsQuery,
  getPublicProfile,
} = await import("./profile-read");
const { PUBLIC_PLAYER_PROFILE_KEYS } = await import("./public-profile");
const { repTag } = await import("./constants");

const DAY = 86_400_000;
const NOW = new Date("2026-11-20T00:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
/** Buổi đã đóng chấm từ lâu. */
const CLOSED_END = "2026-11-01T12:00:00.000Z";
const CLOSED_START = "2026-11-01T10:00:00.000Z";

const [venue] = await testDb
  .insert(venues)
  .values({ name: "V", lat: 10, lng: 106 })
  .returning({ id: venues.id });

let seq = 0;
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
/** Mã hồ sơ hợp lệ, khác nhau theo `n`. */
function codeFor(n: number): string {
  let out = "";
  for (let x = n; out.length < 10; x = Math.floor(x / 31)) {
    out += ALPHABET[x % 31];
  }
  return out;
}
async function seedMember(
  o: Partial<typeof members.$inferInsert> = {},
): Promise<number> {
  seq += 1;
  const [m] = await testDb
    .insert(members)
    .values({
      name: `m${seq}`,
      approvalStatus: "pending",
      ...o,
    })
    .returning({ id: members.id });
  return m.id;
}

let codeSeq = 0;
async function seedEvent(
  o: {
    host?: number;
    status?: ExchangeEventStatus;
    hiddenAt?: string | null;
    startAt?: string;
    endAt?: string;
  } = {},
): Promise<{ id: number; code: string; host: number }> {
  const host = o.host ?? (await seedMember({ approvalStatus: "approved" }));
  const code = `ev${String(++codeSeq).padStart(8, "0")}`;
  const [e] = await testDb
    .insert(exchangeEvents)
    .values({
      publicCode: code,
      hostMemberId: host,
      venueId: venue.id,
      title: "t",
      startAt: o.startAt ?? CLOSED_START,
      endAt: o.endAt ?? CLOSED_END,
      slotsTotal: 20,
      feeMode: "fixed",
      registerDeadline: CLOSED_START,
      cancelDeadline: CLOSED_START,
      status: o.status ?? "done",
      hiddenAt: o.hiddenAt ?? null,
      createdAt: CLOSED_START,
      updatedAt: CLOSED_START,
    })
    .returning({ id: exchangeEvents.id });
  return { id: e.id, code, host };
}

async function reg(
  eventId: number,
  memberId: number,
  o: {
    status?: ExchangeRegStatus;
    checkedIn?: boolean;
    feeAmount?: number | null;
    feeWaived?: boolean;
    paid?: boolean;
    paidAt?: string | null;
  } = {},
) {
  await testDb.insert(exchangeRegistrations).values({
    eventId,
    memberId,
    status: o.status ?? "approved",
    maleCount: 1,
    checkedIn: o.checkedIn ?? true,
    feeAmount: o.feeAmount ?? null,
    feeWaived: o.feeWaived ?? false,
    paid: o.paid ?? false,
    paidAt: o.paidAt ?? null,
    createdAt: CLOSED_START,
    updatedAt: CLOSED_START,
  });
}

let fbClock = Date.parse("2026-11-02T00:00:00.000Z");
async function peer(
  eventId: number,
  from: number,
  to: number,
  o: {
    playAgain?: boolean;
    tags?: string[];
    skill?: SkillLevel | null;
    w5?: number;
  } = {},
) {
  const at = iso((fbClock += 1000));
  await testDb.insert(peerFeedback).values({
    eventId,
    fromMemberId: from,
    toMemberId: to,
    playAgain: o.playAgain ?? true,
    tags: JSON.stringify(o.tags ?? ["friendly"]),
    skillLevel: o.skill ?? null,
    raterWeight: o.w5 ?? 5,
    createdAt: at,
    updatedAt: at,
  });
}
async function hostFb(
  eventId: number,
  from: number,
  asDescribed: boolean,
  feeAsPromised: boolean,
  w5 = 5,
) {
  const at = iso((fbClock += 1000));
  await testDb.insert(hostFeedback).values({
    eventId,
    fromMemberId: from,
    asDescribed,
    feeAsPromised,
    raterWeight: w5,
    createdAt: at,
    updatedAt: at,
  });
}

/** Buổi có `target` và `n` người chấm, tất cả được điểm danh, ai cũng chấm target. */
async function ratedEvent(
  target: number,
  n: number,
  o: { endAt?: string; host?: number } = {},
) {
  const ev = await seedEvent({ endAt: o.endAt, host: o.host });
  await reg(ev.id, target);
  const raters: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = await seedMember();
    raters.push(r);
    await reg(ev.id, r);
    await peer(ev.id, r, target);
  }
  return { ev, raters };
}

async function one(memberId: number, now = NOW) {
  const m = await testDb
    .select({ approvalStatus: members.approvalStatus })
    .from(members)
    .where(eq(members.id, memberId));
  const map = await attendanceSummaries(
    testDb,
    [{ id: memberId, approvalStatus: m[0].approvalStatus }],
    now,
  );
  return map.get(memberId)!;
}

async function plan(q: ReturnType<typeof peerRowsQuery>): Promise<string[]> {
  const rows = await testDb.all<{ detail: string }>(
    sql`EXPLAIN QUERY PLAN ${q}`,
  );
  return rows.map((r) => r.detail);
}

describe("attendanceSummaries", () => {
  it("attendance counts only past, visible, uncancelled events with a valid check-in; approvedPast only where the host checked someone in", async () => {
    const m = await seedMember();
    const other = async (eventId: number) => reg(eventId, await seedMember());

    const e1 = await seedEvent(); // đến, tính
    await reg(e1.id, m);
    const e2 = await seedEvent({ hiddenAt: CLOSED_END }); // ẩn
    await reg(e2.id, m);
    const e3 = await seedEvent({ status: "cancelled" }); // huỷ
    await reg(e3.id, m);
    const e4 = await seedEvent({
      startAt: iso(NOW.getTime() - 3_600_000),
      endAt: iso(NOW.getTime() + 3_600_000),
      status: "locked",
    }); // đang diễn ra
    await reg(e4.id, m);
    const e5 = await seedEvent(); // duyệt, không được điểm danh, có người khác được
    await reg(e5.id, m, { checkedIn: false });
    await other(e5.id);
    const e6 = await seedEvent(); // host không điểm danh ai
    await reg(e6.id, m, { checkedIn: false });
    const e7 = await seedEvent();
    await reg(e7.id, m, { status: "no_show", checkedIn: false });
    await other(e7.id);
    const e8 = await seedEvent();
    await reg(e8.id, m, { status: "late_cancelled", checkedIn: false });
    await other(e8.id);

    expect(await one(m)).toMatchObject({
      attended: 1,
      approvedPast: 4,
      lateCancels: 1,
      noShows: 1,
    });
  });

  it("a merge-cancelled registration with checked_in 1 is not attended", async () => {
    const m = await seedMember();
    const e = await seedEvent();
    await reg(e.id, m, { status: "cancelled", checkedIn: true });
    await reg(e.id, await seedMember());
    expect(await one(m)).toMatchObject({ attended: 0, approvedPast: 0 });
  });

  it("paid exactly at start plus 24h is on time, 1 ms later is late; unpaid or waived rows are not charged; events less than 24h past start are not counted", async () => {
    const m = await seedMember();
    const due = Date.parse(CLOSED_START) + DAY;
    const fee = { feeAmount: 100_000 };

    const onTime = await seedEvent();
    await reg(onTime.id, m, { ...fee, paid: true, paidAt: iso(due) });
    const late = await seedEvent();
    await reg(late.id, m, { ...fee, paid: true, paidAt: iso(due + 1) });
    // Không có tiền phải trả ("unpaid"): phí NULL hoặc 0.
    const free = await seedEvent();
    await reg(free.id, m, { feeAmount: null });
    const zero = await seedEvent();
    await reg(zero.id, m, { feeAmount: 0 });
    const waived = await seedEvent();
    await reg(waived.id, m, { ...fee, feeWaived: true });
    // Chưa chốt phí (buổi còn mở) thì chưa tính.
    const notSettled = await seedEvent({ status: "full" });
    await reg(notSettled.id, m, fee);
    // Mới qua giờ bắt đầu 23 giờ: chưa tới hạn trả.
    const recent = await seedEvent({
      startAt: iso(NOW.getTime() - 23 * 3_600_000),
      endAt: iso(NOW.getTime() - 21 * 3_600_000),
    });
    await reg(recent.id, m, fee);
    // Không đến (vẫn bị tính phí) mà không trả: bị tính, trễ hạn.
    const noShow = await seedEvent();
    await reg(noShow.id, m, { ...fee, status: "no_show", checkedIn: false });
    // Đăng ký không bị tính phí (huỷ sớm) thì không tính.
    const early = await seedEvent();
    await reg(early.id, m, { ...fee, status: "cancelled", checkedIn: false });

    expect(await one(m)).toMatchObject({ charged: 3, paidOnTime: 1 });
  });

  it("isNew: approved never; pending without a check-in yes; one check-in anywhere no", async () => {
    const approved = await seedMember({ approvalStatus: "approved" });
    const fresh = await seedMember();
    const once = await seedMember();
    const hidden = await seedEvent({ hiddenAt: CLOSED_END });
    await reg(hidden.id, once, { checkedIn: true });

    expect((await one(approved)).isNew).toBe(false);
    expect((await one(fresh)).isNew).toBe(true);
    expect((await one(once)).isNew).toBe(false);
    expect(await one(fresh)).toEqual({
      attended: 0,
      approvedPast: 0,
      lateCancels: 0,
      noShows: 0,
      charged: 0,
      paidOnTime: 0,
      isNew: true,
    });
  });

  it("attendance for three members runs one query", async () => {
    const ids = [await seedMember(), await seedMember(), await seedMember()];
    const e = await seedEvent();
    for (const id of ids) await reg(e.id, id);
    const exec = vi.spyOn(client, "execute");
    try {
      const map = await attendanceSummaries(
        testDb,
        ids.map((id) => ({ id, approvalStatus: "pending" })),
        NOW,
      );
      expect(exec).toHaveBeenCalledTimes(1);
      expect([...map.keys()].sort()).toEqual([...ids].sort());
      for (const id of ids) expect(map.get(id)?.attended).toBe(1);
      expect(await attendanceSummaries(testDb, [], NOW)).toEqual(new Map());
      expect(exec).toHaveBeenCalledTimes(1);
    } finally {
      exec.mockRestore();
    }
  });
});

describe("loadReputation: peer", () => {
  it("ratings of an event still inside its 7-day window are not counted", async () => {
    const t = await seedMember();
    const end = iso(NOW.getTime() - 2 * DAY);
    await ratedEvent(t, 3, { endAt: end });
    expect((await loadReputation(testDb, t, NOW))!.peer.raters).toBeNull();
    const closedAt = new Date(Date.parse(end) + 7 * DAY);
    const justBefore = new Date(closedAt.getTime() - 1);
    expect((await loadReputation(testDb, t, justBefore))!.peer.raters).toBe(
      null,
    );
    expect((await loadReputation(testDb, t, closedAt))!.peer.raters).toBe(3);
  });

  it("an event with 2 raters of a player adds nothing even when the total reaches 3", async () => {
    const t = await seedMember();
    await ratedEvent(t, 2);
    await ratedEvent(t, 1);
    expect((await loadReputation(testDb, t, NOW))!.peer).toEqual({
      raters: null,
      playAgain: null,
      tags: [],
      skill: null,
    });
    await ratedEvent(t, 3);
    expect((await loadReputation(testDb, t, NOW))!.peer.raters).toBe(3);
  });

  it("peer feedback from a rater later un-checked-in, a locked rater, a hidden event, or to a target later un-checked-in is left out", async () => {
    const setRegChecked = (eventId: number, memberId: number) =>
      testDb.run(
        sql`UPDATE exchange_registrations SET checked_in = 0 WHERE event_id = ${eventId} AND member_id = ${memberId}`,
      );
    const cases: ((s: {
      ev: { id: number };
      raters: number[];
      t: number;
    }) => Promise<unknown>)[] = [
      ({ ev, raters }) => setRegChecked(ev.id, raters[0]),
      ({ raters }) =>
        testDb
          .update(members)
          .set({ isActive: false })
          .where(eq(members.id, raters[0])),
      ({ raters }) =>
        testDb
          .update(members)
          .set({ approvalStatus: "rejected" })
          .where(eq(members.id, raters[0])),
      ({ ev }) =>
        testDb
          .update(exchangeEvents)
          .set({ hiddenAt: CLOSED_END })
          .where(eq(exchangeEvents.id, ev.id)),
      ({ ev, t }) => setRegChecked(ev.id, t),
    ];
    for (const mutate of cases) {
      const t = await seedMember();
      const { ev, raters } = await ratedEvent(t, 3);
      expect((await loadReputation(testDb, t, NOW))!.peer.raters).toBe(3);
      await mutate({ ev, raters, t });
      expect((await loadReputation(testDb, t, NOW))!.peer.raters).toBeNull();
    }
  });
});

describe("loadReputation: host", () => {
  it("organized counts past, uncancelled, visible events with a check-in; a cancelled event with no approved registration does not count as cancelled", async () => {
    const h = await seedMember({ approvalStatus: "approved" });
    const p = async () => seedMember();

    const a = await seedEvent({ host: h });
    await reg(a.id, await p());
    const b = await seedEvent({ host: h }); // không ai được điểm danh
    await reg(b.id, await p(), { checkedIn: false });
    const c = await seedEvent({ host: h, hiddenAt: CLOSED_END });
    await reg(c.id, await p());
    const d = await seedEvent({
      host: h,
      startAt: iso(NOW.getTime() - 3_600_000),
      endAt: iso(NOW.getTime() + 3_600_000),
      status: "locked",
    });
    await reg(d.id, await p());
    const merged = await seedEvent({ host: h }); // chỉ có điểm danh bị huỷ do gộp
    await reg(merged.id, await p(), { status: "cancelled", checkedIn: true });
    const e = await seedEvent({ host: h, status: "cancelled" });
    await reg(e.id, await p(), { checkedIn: false });
    const f = await seedEvent({ host: h, status: "cancelled" });
    await reg(f.id, await p(), { status: "pending", checkedIn: false });
    const g = await seedEvent({
      host: h,
      status: "cancelled",
      hiddenAt: CLOSED_END,
    });
    await reg(g.id, await p(), { checkedIn: false });

    const rep = await loadReputation(testDb, h, NOW);
    expect(rep!.host).toMatchObject({
      organized: 1,
      cancelled: 1,
      cancelPct: 50,
    });
  });

  it("someone who never organized or cancelled an event has no host block", async () => {
    const m = await seedMember();
    expect((await loadReputation(testDb, m, NOW))!.host).toBeNull();
    const upcoming = await seedEvent({
      host: m,
      status: "open",
      startAt: iso(NOW.getTime() + DAY),
      endAt: iso(NOW.getTime() + DAY + 7_200_000),
    });
    void upcoming;
    expect((await loadReputation(testDb, m, NOW))!.host).toBeNull();
  });

  it("host percentages need three raters per event and use each rater's latest answer; raters is null below 3", async () => {
    const h = await seedMember({ approvalStatus: "approved" });
    const r = [] as number[];
    for (let i = 0; i < 7; i++) r.push(await seedMember());

    const e1 = await seedEvent({ host: h });
    for (const x of [r[0], r[1], r[2]]) await reg(e1.id, x);
    await hostFb(e1.id, r[0], true, true);
    await hostFb(e1.id, r[1], true, false);
    await hostFb(e1.id, r[2], false, false);
    const e2 = await seedEvent({ host: h });
    for (const x of [r[0], r[3], r[4]]) await reg(e2.id, x);
    await hostFb(e2.id, r[0], false, false); // mới hơn câu ở e1
    await hostFb(e2.id, r[3], true, true);
    await hostFb(e2.id, r[4], true, true);
    const e3 = await seedEvent({ host: h }); // chỉ 2 người chấm
    for (const x of [r[5], r[6]]) await reg(e3.id, x);
    await hostFb(e3.id, r[5], false, false);
    await hostFb(e3.id, r[6], false, false);

    expect((await loadReputation(testDb, h, NOW))!.host).toMatchObject({
      raters: 5,
      asDescribedPct: 60,
      feeAsPromisedPct: 40,
    });

    const h2 = await seedMember({ approvalStatus: "approved" });
    const lone = await seedEvent({ host: h2 });
    for (const x of [r[5], r[6]]) await reg(lone.id, x);
    await hostFb(lone.id, r[5], true, true);
    await hostFb(lone.id, r[6], true, true);
    expect((await loadReputation(testDb, h2, NOW))!.host).toMatchObject({
      organized: 1,
      raters: null,
      asDescribedPct: null,
      feeAsPromisedPct: null,
    });
  });

  it("host views their profile before and after a one-player event: no number changes", async () => {
    const h = await seedMember({ approvalStatus: "approved" });
    // Mốc sẵn có: một buổi đủ 3 người chấm host và chấm nhau.
    const base = await seedEvent({ host: h });
    const ps = [await seedMember(), await seedMember(), await seedMember()];
    for (const x of ps) await reg(base.id, x);
    for (const x of ps) await hostFb(base.id, x, true, true);
    for (const x of ps)
      for (const y of ps) if (x !== y) await peer(base.id, x, y);

    // Buổi chỉ một người chơi, đã qua và đã đóng chấm từ lâu.
    const small = await seedEvent({ host: h });
    const solo = await seedMember();
    await reg(small.id, solo);

    const before = await loadReputation(testDb, h, NOW);
    expect(before!.host!.raters).toBe(3);
    // Người chơi duy nhất trả lời "không" cả hai câu.
    await hostFb(small.id, solo, false, false);
    const after = await loadReputation(testDb, h, NOW);
    expect(after).toEqual(before);
    // Lâu sau đó cũng vậy.
    const later = new Date(NOW.getTime() + 30 * DAY);
    expect((await loadReputation(testDb, h, later))!.host).toEqual(
      before!.host,
    );
  });
});

describe("getPublicProfile", () => {
  beforeEach(() => {
    cache.clear();
    mocks.flag.mockResolvedValue(true);
  });
  afterEach(() => {
    mocks.flag.mockReset();
  });

  async function profiled(name = "Target Person") {
    const code = codeFor(++seq);
    const t = await seedMember({
      name,
      email: `t${seq}@fwbb.test`,
      phoneNumber: "0912345678",
      publicCode: code,
      skillLevel: "tb",
    });
    return { t, code };
  }

  it("profile has exactly PUBLIC_PLAYER_PROFILE_KEYS; JSON has no member id, email, phone, event code or rater name", async () => {
    const { t, code } = await profiled();
    const ev = await seedEvent();
    await reg(ev.id, t);
    for (let i = 0; i < 3; i++) {
      const r = await seedMember({ name: `RaterSecret${i}` });
      await reg(ev.id, r);
      await peer(ev.id, r, t, { tags: ["friendly", "on_time"], skill: "tby" });
    }
    const p = await getPublicProfile(code);
    expect(p).not.toBeNull();
    expect(Object.keys(p!).sort()).toEqual(
      [...PUBLIC_PLAYER_PROFILE_KEYS].sort(),
    );
    expect(p!.peer.raters).toBe(3);
    const json = JSON.stringify(p);
    for (const bad of [
      "RaterSecret",
      `t${t}@`,
      "@fwbb.test",
      "0912345678",
      ev.code,
      '"id"',
      "memberId",
      "email",
      "phone",
    ]) {
      expect(json).not.toContain(bad);
    }
  });

  it("the code cache stores only the id; a second read runs no DB query; updateTag(repTag(id)) refreshes name, skill and numbers", async () => {
    const { t, code } = await profiled("Old Name");
    const first = await getPublicProfile(code);
    expect(first).toMatchObject({ name: "Old Name", selfSkill: "tb" });
    expect(first!.attendance.attended).toBe(0);

    const codeEntries = [...cache.store].filter(([k]) => k.includes('"pcode"'));
    expect(codeEntries).toHaveLength(1);
    expect(JSON.parse(codeEntries[0][1].json)).toEqual({ id: t });
    expect(codeEntries[0][1].tags).toEqual(["exchange"]);
    const repEntries = [...cache.store].filter(([k]) => k.includes('"rep"'));
    expect(repEntries).toHaveLength(1);
    expect(repEntries[0][1].tags).toEqual([repTag(t)]);

    const exec = vi.spyOn(client, "execute");
    try {
      expect(await getPublicProfile(code)).toEqual(first);
      expect(exec).not.toHaveBeenCalled();
    } finally {
      exec.mockRestore();
    }

    await testDb
      .update(members)
      .set({ name: "New Name", skillLevel: "tbk" })
      .where(eq(members.id, t));
    const ev = await seedEvent();
    await reg(ev.id, t);
    expect(await getPublicProfile(code)).toEqual(first);

    cache.updateTag(repTag(t));
    const fresh = await getPublicProfile(code);
    expect(fresh).toMatchObject({ name: "New Name", selfSkill: "tbk" });
    expect(fresh!.attendance.attended).toBe(1);
  });

  // Final review M2: bot dò mã ngẫu nhiên đúng dạng không được đẻ ra một mục
  // cache cho mỗi mã (như id sân không tồn tại ở Task 9).
  it("an unknown well-formed code returns null and caches nothing; it resolves once the code exists", async () => {
    const code = codeFor(++seq);
    expect(await getPublicProfile(code)).toBeNull();
    expect(await getPublicProfile("zzzzzzzzzz")).toBeNull();
    expect(
      [...cache.store.keys()].filter((k) => k.includes('"pcode"')),
    ).toEqual([]);

    const t = await seedMember({ name: "Late Code", publicCode: code });
    expect(await getPublicProfile(code)).toMatchObject({ name: "Late Code" });
    const entries = [...cache.store].filter(([k]) => k.includes('"pcode"'));
    expect(entries.map(([, v]) => JSON.parse(v.json))).toEqual([{ id: t }]);
  });

  it("locked, rejected, unknown or malformed code returns null; flag off returns null before any DB read", async () => {
    const locked = await profiled();
    await testDb
      .update(members)
      .set({ isActive: false })
      .where(eq(members.id, locked.t));
    const rejected = await profiled();
    await testDb
      .update(members)
      .set({ approvalStatus: "rejected" })
      .where(eq(members.id, rejected.t));
    const ok = await profiled();

    expect(await getPublicProfile(locked.code)).toBeNull();
    expect(await getPublicProfile(rejected.code)).toBeNull();
    expect(await getPublicProfile("zzzzzzzzzz")).toBeNull();
    for (const bad of [
      "",
      "short",
      "abcdefghjkm",
      "ABCDEFGHJK",
      "abcdefghj1",
      "abcdefghjo",
      "abc'; drop",
    ]) {
      expect(await getPublicProfile(bad)).toBeNull();
    }
    expect(await getPublicProfile(ok.code)).not.toBeNull();

    cache.clear();
    mocks.flag.mockResolvedValue(false);
    const exec = vi.spyOn(client, "execute");
    try {
      expect(await getPublicProfile(ok.code)).toBeNull();
      expect(exec).not.toHaveBeenCalled();
      expect(cache.store.size).toBe(0);
    } finally {
      exec.mockRestore();
    }
  });
});

// Final review M5: trần 500 dòng từng cắt TRƯỚC bước lọc "buổi có ít nhất 3
// người chấm", nên ở biên trần một buổi bị tách và rơi khỏi điểm dù đủ người.
describe("row cap at 500 for a very active member", () => {
  /** `events` buổi, mỗi buổi `perEvent` người chấm mới; ghi lô cho nhanh. */
  async function filler(
    target: number,
    events: number,
    perEvent: number,
    kind: "peer" | "host",
  ) {
    const host = kind === "host" ? target : undefined;
    const raters = await testDb
      .insert(members)
      .values(
        Array.from({ length: perEvent }, () => ({
          name: `f${++seq}`,
          approvalStatus: "pending" as const,
        })),
      )
      .returning({ id: members.id });
    for (let e = 0; e < events; e++) {
      const ev = await seedEvent({ host });
      const regs = raters.map((r) => r.id);
      if (kind === "peer") regs.push(target);
      await testDb.insert(exchangeRegistrations).values(
        regs.map((memberId) => ({
          eventId: ev.id,
          memberId,
          status: "approved" as const,
          maleCount: 1,
          checkedIn: true,
          createdAt: CLOSED_START,
          updatedAt: CLOSED_START,
        })),
      );
      const rows = raters.map((r) => {
        const at = iso((fbClock += 1000));
        return { eventId: ev.id, fromMemberId: r.id, at };
      });
      if (kind === "peer") {
        await testDb.insert(peerFeedback).values(
          rows.map((r) => ({
            eventId: r.eventId,
            fromMemberId: r.fromMemberId,
            toMemberId: target,
            playAgain: false,
            tags: "[]",
            raterWeight: 5,
            createdAt: r.at,
            updatedAt: r.at,
          })),
        );
      } else {
        await testDb.insert(hostFeedback).values(
          rows.map((r) => ({
            eventId: r.eventId,
            fromMemberId: r.fromMemberId,
            asDescribed: true,
            feeAsPromised: true,
            raterWeight: 5,
            createdAt: r.at,
            updatedAt: r.at,
          })),
        );
      }
    }
  }

  it("peer: the newest rater of an event whose other raters fall past the cap still counts", async () => {
    const t = await seedMember();
    const ev = await seedEvent();
    await reg(ev.id, t);
    const [a, b, c] = [
      await seedMember(),
      await seedMember(),
      await seedMember(),
    ];
    for (const r of [a, b, c]) await reg(ev.id, r);
    await peer(ev.id, b, t, { playAgain: false, tags: [] });
    await peer(ev.id, c, t, { playAgain: false, tags: [] });
    await filler(t, 4, 125, "peer"); // 500 dòng mới hơn b, c
    await peer(ev.id, a, t, { playAgain: false, tags: ["fair_play"] });

    const rep = await loadReputation(testDb, t, NOW);
    expect(rep!.peer.tags).toEqual([{ tag: "fair_play", count: 1 }]);
  });

  it("host: the newest answer of an event whose other raters fall past the cap still counts", async () => {
    const h = await seedMember({ approvalStatus: "approved" });
    const ev = await seedEvent({ host: h });
    const [a, b, c] = [
      await seedMember(),
      await seedMember(),
      await seedMember(),
    ];
    for (const r of [a, b, c]) await reg(ev.id, r);
    await hostFb(ev.id, b, true, true);
    await hostFb(ev.id, c, true, true);
    await filler(h, 4, 125, "host");
    await hostFb(ev.id, a, false, true);

    const host = (await loadReputation(testDb, h, NOW))!.host!;
    // 125 người chấm đệm (mỗi người một dòng mới nhất) "có" + a "không".
    expect(host.raters).toBe(126);
    expect(host.asDescribedPct).toBe(90);
    const kept = await testDb.all<{ fromId: number }>(
      hostRowsQuery(h, iso(NOW.getTime() - 7 * DAY)),
    );
    expect(kept.map((r) => Number(r.fromId))).toContain(a);
  });
});

describe("query plans", () => {
  it("EXPLAIN QUERY PLAN of peer rows, host rows and attendance has no SCAN of peer_feedback, host_feedback or exchange_registrations", async () => {
    const cutoff = iso(NOW.getTime() - 7 * DAY);
    const plans = {
      peer: await plan(peerRowsQuery(1, cutoff)),
      host: await plan(hostRowsQuery(1, cutoff)),
      hostCounts: await plan(hostCountsQuery(1, NOW.toISOString())),
      attendance: await plan(attendanceQuery([1, 2, 3], NOW.toISOString())),
    };
    for (const [name, details] of Object.entries(plans)) {
      const scans = details.filter((d) => /\bSCAN\b/.test(d));
      expect({ name, scans }).toEqual({ name, scans: [] });
    }
    expect(plans.peer.join("\n")).toMatch(/peer_feedback_to_updated_idx/);
    expect(plans.peer.join("\n")).toMatch(
      /exchange_registrations_event_member_unique/,
    );
    expect(plans.host.join("\n")).toMatch(/exchange_events_host_start_idx/);
    expect(plans.host.join("\n")).toMatch(/host_feedback_event_from_unique/);
    // M5: truy vấn con lọc buổi (>= 3 người chấm) cũng đi theo index.
    const uses = (lines: string[], idx: string) =>
      lines.filter((d) => d.includes(idx)).length;
    expect(uses(plans.peer, "peer_feedback_to_updated_idx")).toBe(2);
    expect(uses(plans.host, "exchange_events_host_start_idx")).toBe(2);
    expect(plans.hostCounts.join("\n")).toMatch(
      /exchange_events_host_start_idx/,
    );
    expect(plans.attendance.join("\n")).toMatch(
      /exchange_registrations_member_/,
    );
    expect(plans.attendance.join("\n")).toMatch(
      /exchange_registrations_event_status_idx/,
    );
  });
});

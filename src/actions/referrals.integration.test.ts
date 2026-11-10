import {
  describe,
  it,
  expect,
  beforeEach,
  beforeAll,
  afterAll,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import {
  exchangeEvents,
  exchangeRegistrations,
  members,
  rateLimitBuckets,
  referrals,
  sessionAttendees,
  sessions,
  venues,
} from "@/db/schema";
import { repTag } from "@/lib/reputation/constants";

const mocks = vi.hoisted(() => ({
  flag: vi.fn(),
  auth: vi.fn(),
  verify: vi.fn(),
  bot: vi.fn(),
  realBot: null as unknown as (...args: never[]) => unknown,
  updateTag: vi.fn(),
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
// Mặc định chạy checkBotAndRate thật (Turnstile mock + rate limit ghi DB thật).
vi.mock("@/lib/exchange/guards", async (orig) => {
  const real = await orig<typeof import("@/lib/exchange/guards")>();
  mocks.realBot = real.checkBotAndRate as never;
  return { ...real, checkBotAndRate: mocks.bot };
});
vi.mock("next/cache", () => ({
  updateTag: mocks.updateTag,
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

const { db: testDb } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { referMember, getMyReferralState, ensureMyPublicCode } =
  await import("./referrals");
const { getPublicProfile } = await import("@/lib/reputation/profile-read");

type Member = typeof members.$inferSelect;
const DAY = 86_400_000;
const NOW = Date.parse("2026-11-20T03:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

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
/** Mã hồ sơ đúng bảng chữ của `newPublicCode` (không 0, 1, i, l, o). */
function codeOf(n: number): string {
  const digits = "23456789";
  let s = "";
  for (let v = n, i = 0; i < 8; i++, v = Math.floor(v / 8)) s += digits[v % 8];
  return `rf${s}`;
}
async function newMember(
  over: Partial<typeof members.$inferInsert> = {},
): Promise<Member> {
  seq += 1;
  const [m] = await testDb
    .insert(members)
    .values({
      name: `M${seq}`,
      approvalStatus: "pending",
      publicCode: codeOf(seq),
      ...over,
    })
    .returning();
  return m;
}
function asMember(m: Member) {
  mocks.auth.mockResolvedValue({
    user: { memberId: m.id, externalId: "x" },
    member: m,
  });
}

async function mkEvent(over: Partial<typeof exchangeEvents.$inferInsert> = {}) {
  seq += 1;
  const start = NOW - 30 * DAY;
  const [ev] = await testDb
    .insert(exchangeEvents)
    .values({
      publicCode: `re${String(seq).padStart(8, "0")}`,
      hostMemberId: host.id,
      venueId: venue.id,
      title: "Giao luu",
      startAt: iso(start),
      endAt: iso(start + 2 * 3_600_000),
      slotsTotal: 10,
      feeMode: "fixed",
      registerDeadline: iso(start - DAY),
      cancelDeadline: iso(start - DAY),
      status: "done",
      createdAt: iso(start - 3 * DAY),
      updatedAt: iso(start - 3 * DAY),
      ...over,
    })
    .returning();
  return ev;
}
async function addReg(
  eventId: number,
  memberId: number,
  o: Partial<typeof exchangeRegistrations.$inferInsert> = {},
) {
  await testDb.insert(exchangeRegistrations).values({
    eventId,
    memberId,
    status: "approved",
    maleCount: 1,
    femaleCount: 0,
    checkedIn: true,
    createdAt: iso(NOW - 40 * DAY),
    updatedAt: iso(NOW - 40 * DAY),
    ...o,
  });
}
/** Người đã đến `n` buổi giao lưu (điểm danh hợp lệ, buổi đã qua). */
async function referrer(n = 3): Promise<Member> {
  const m = await newMember();
  for (let i = 0; i < n; i++) await addReg((await mkEvent()).id, m.id);
  return m;
}
/** Một buổi đã qua có người khác được điểm danh (để tính vào tỉ lệ đến). */
async function pastEventWithCheckIn(
  over: Partial<typeof exchangeEvents.$inferInsert> = {},
) {
  const ev = await mkEvent(over);
  const other = await newMember();
  await addReg(ev.id, other.id);
  return ev;
}

const input = (code: string, turnstileToken = "tok") => ({
  code,
  turnstileToken,
});
const rowsFor = (refereeId: number) =>
  testDb
    .select()
    .from(referrals)
    .where(eq(referrals.refereeMemberId, refereeId));
const rowsBy = (referrerId: number) =>
  testDb
    .select()
    .from(referrals)
    .where(eq(referrals.referrerMemberId, referrerId));

beforeEach(async () => {
  vi.setSystemTime(NOW);
  mocks.flag.mockReset().mockResolvedValue(true);
  mocks.auth.mockReset();
  mocks.verify.mockReset().mockResolvedValue({ ok: true });
  mocks.bot.mockReset().mockImplementation(mocks.realBot);
  mocks.updateTag.mockReset();
  await testDb.delete(rateLimitBuckets);
});

describe("referMember: guards", () => {
  it("flag off returns notFound before auth and Turnstile", async () => {
    const r = await referrer();
    const n = await newMember();
    asMember(r);
    mocks.flag.mockResolvedValue(false);
    expect(await referMember(input(n.publicCode!))).toEqual({
      error: "notFound",
    });
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(await testDb.select().from(rateLimitBuckets)).toHaveLength(0);
    expect(await rowsFor(n.id)).toHaveLength(0);
  });

  it("failed Turnstile writes no rate_limit_buckets row and no referral", async () => {
    const r = await referrer();
    const n = await newMember();
    asMember(r);
    mocks.verify.mockResolvedValue({ ok: false, reason: "invalid" });
    expect(await referMember(input(n.publicCode!))).toEqual({
      error: "captcha",
    });
    expect(mocks.verify).toHaveBeenCalledWith(
      "tok",
      expect.objectContaining({ action: "exchange_referral" }),
    );
    expect(await testDb.select().from(rateLimitBuckets)).toHaveLength(0);
    expect(await rowsFor(n.id)).toHaveLength(0);
  });

  it("invalid input is rejected before Turnstile", async () => {
    const r = await referrer();
    asMember(r);
    for (const bad of [
      { code: "short", turnstileToken: "tok" },
      { code: "rf23456789" },
      { code: "rf23456789", turnstileToken: "" },
      null,
    ]) {
      expect(await referMember(bad)).toEqual({ error: "invalidInput" });
    }
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(await testDb.select().from(rateLimitBuckets)).toHaveLength(0);
  });
});

describe("referMember: writes", () => {
  it("an eligible member refers a new account by code", async () => {
    const r = await referrer();
    const n = await newMember();
    asMember(r);
    expect(await referMember(input(n.publicCode!))).toEqual({ success: true });
    const rows = await rowsFor(n.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      referrerMemberId: r.id,
      refereeMemberId: n.id,
      createdAt: iso(NOW),
    });
    expect(mocks.updateTag).toHaveBeenCalledWith(repTag(n.id));
    const buckets = await testDb.select().from(rateLimitBuckets);
    expect(buckets.map((b) => b.key)).toEqual([`exchange-referral:${r.id}`]);
  });

  it("self, approved, checked-in, locked, rejected or unknown target is refused", async () => {
    const r = await referrer();
    asMember(r);
    const approved = await newMember({ approvalStatus: "approved" });
    const checkedIn = await newMember();
    await addReg((await mkEvent()).id, checkedIn.id);
    // Điểm danh ở buổi bị ẩn vẫn là "đã điểm danh" (định nghĩa nick mới G2b).
    const hiddenCheckIn = await newMember();
    await addReg(
      (await mkEvent({ hiddenAt: iso(NOW - DAY) })).id,
      hiddenCheckIn.id,
    );
    const locked = await newMember({ isActive: false });
    const rejected = await newMember({ approvalStatus: "rejected" });
    const targets = [
      r.publicCode!,
      approved.publicCode!,
      checkedIn.publicCode!,
      hiddenCheckIn.publicCode!,
      locked.publicCode!,
      rejected.publicCode!,
      "rfzzzzzzzz",
    ];
    for (const code of targets) {
      expect(await referMember(input(code))).toEqual({
        error: "referralTargetInvalid",
      });
    }
    expect(await rowsBy(r.id)).toHaveLength(0);
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });

  it("another referrer gets referralTaken; the same referrer resending gets success, one row", async () => {
    const r1 = await referrer();
    const r2 = await referrer();
    const n = await newMember();
    asMember(r1);
    expect(await referMember(input(n.publicCode!))).toEqual({ success: true });
    asMember(r2);
    expect(await referMember(input(n.publicCode!))).toEqual({
      error: "referralTaken",
    });
    // Gửi lại sau khi mất phản hồi: token đã dùng, vẫn trả kết quả cũ.
    asMember(r1);
    mocks.verify.mockResolvedValue({ ok: false, reason: "invalid" });
    expect(await referMember(input(n.publicCode!))).toEqual({ success: true });
    const rows = await rowsFor(n.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].referrerMemberId).toBe(r1.id);
  });

  it("two referrers racing end with one row", async () => {
    const r1 = await referrer();
    const r2 = await referrer();
    const n = await newMember();
    // DB file của test mở kết nối mới cho mỗi transaction: transaction rate
    // limit chạy cạnh transaction ghi sẽ SQLITE_BUSY, điều Turso thật không gặp
    // (như test hai tab của reputation-feedback). Bỏ phần ghi rate limit.
    mocks.bot.mockResolvedValue({ ok: true });
    const authOf = (m: Member) => ({
      user: { memberId: m.id, externalId: "x" },
      member: m,
    });
    mocks.auth
      .mockResolvedValueOnce(authOf(r1))
      .mockResolvedValueOnce(authOf(r2));
    const results = await Promise.all([
      referMember(input(n.publicCode!)),
      referMember(input(n.publicCode!)),
    ]);
    expect(results).toEqual(
      expect.arrayContaining([{ success: true }, { error: "referralTaken" }]),
    );
    expect(await rowsFor(n.id)).toHaveLength(1);
  });

  it("six referrals sent at once store exactly five; the first of next VN month is allowed", async () => {
    // 23:59 ngày 30/11 giờ VN.
    const lastMinute = Date.parse("2026-11-30T16:59:00.000Z");
    vi.setSystemTime(lastMinute);
    const r = await referrer();
    asMember(r);
    const news = [];
    for (let i = 0; i < 7; i++) news.push(await newMember());
    // DB file của test mở kết nối mới cho mỗi transaction: transaction rate
    // limit chạy cạnh transaction ghi sẽ SQLITE_BUSY, điều Turso thật không gặp
    // (như test hai tab của reputation-feedback). Bỏ phần ghi rate limit.
    mocks.bot.mockResolvedValue({ ok: true });
    const results = await Promise.all(
      news.slice(0, 6).map((n) => referMember(input(n.publicCode!))),
    );
    expect(results.filter((x) => "success" in x)).toHaveLength(5);
    expect(results.filter((x) => "error" in x)).toEqual([
      { error: "referralQuota" },
    ]);
    expect(await rowsBy(r.id)).toHaveLength(5);

    // 00:00 ngày 1/12 giờ VN là tháng mới.
    vi.setSystemTime(Date.parse("2026-11-30T17:00:00.000Z"));
    expect(await referMember(input(news[6].publicCode!))).toEqual({
      success: true,
    });
    expect(await rowsBy(r.id)).toHaveLength(6);
  });

  it("a no-show plus a late cancel in 30 days blocks the referrer until 30 days after the second", async () => {
    const r = await referrer();
    const old = await newMember();
    await testDb.insert(referrals).values({
      referrerMemberId: r.id,
      refereeMemberId: old.id,
      createdAt: iso(NOW - 12 * DAY),
    });
    // Vắng tính theo giờ bắt đầu buổi, huỷ muộn theo giờ huỷ (quyết định 43).
    const e1 = await pastEventWithCheckIn({
      startAt: iso(NOW - 7 * DAY),
      endAt: iso(NOW - 7 * DAY + 7_200_000),
    });
    await addReg(e1.id, old.id, { status: "no_show", checkedIn: false });
    const e2 = await pastEventWithCheckIn({
      startAt: iso(NOW - 3 * DAY),
      endAt: iso(NOW - 3 * DAY + 7_200_000),
    });
    await addReg(e2.id, old.id, {
      status: "late_cancelled",
      checkedIn: false,
      cancelledAt: iso(NOW - 4 * DAY),
    });

    const n = await newMember();
    asMember(r);
    expect(await referMember(input(n.publicCode!))).toEqual({
      error: "referralBlocked",
    });
    expect(await rowsFor(n.id)).toHaveLength(0);
    const state = await getMyReferralState();
    expect(state).toMatchObject({
      eligible: true,
      usedThisMonth: 1,
      limit: 5,
      blockedUntil: iso(NOW - 4 * DAY + 30 * DAY),
    });

    vi.setSystemTime(NOW + 26 * DAY + 1);
    expect(await referMember(input(n.publicCode!))).toEqual({ success: true });
  });

  it("incidents at a cancelled event do not count toward breaking a referral", async () => {
    const r = await referrer();
    const old = await newMember();
    await testDb.insert(referrals).values({
      referrerMemberId: r.id,
      refereeMemberId: old.id,
      createdAt: iso(NOW - 12 * DAY),
    });
    const e1 = await pastEventWithCheckIn({
      startAt: iso(NOW - 7 * DAY),
      endAt: iso(NOW - 7 * DAY + 7_200_000),
      status: "cancelled",
    });
    await addReg(e1.id, old.id, { status: "no_show", checkedIn: false });
    const e2 = await pastEventWithCheckIn({
      startAt: iso(NOW - 3 * DAY),
      endAt: iso(NOW - 3 * DAY + 7_200_000),
    });
    await addReg(e2.id, old.id, {
      status: "late_cancelled",
      checkedIn: false,
      cancelledAt: iso(NOW - 4 * DAY),
    });
    asMember(r);
    expect((await getMyReferralState())?.blockedUntil).toBeNull();
    const n = await newMember();
    expect(await referMember(input(n.publicCode!))).toEqual({ success: true });
  });

  it("a referrer with 2 sessions or a 75% rate gets referralNotEligible", async () => {
    const two = await referrer(2);
    const n = await newMember();
    asMember(two);
    expect(await referMember(input(n.publicCode!))).toEqual({
      error: "referralNotEligible",
    });

    const rate75 = await referrer(3);
    const missed = await pastEventWithCheckIn();
    await addReg(missed.id, rate75.id, { status: "no_show", checkedIn: false });
    asMember(rate75);
    expect(await referMember(input(n.publicCode!))).toEqual({
      error: "referralNotEligible",
    });
    expect(await rowsFor(n.id)).toHaveLength(0);
    expect((await getMyReferralState())?.eligible).toBe(false);
  });

  // Task 25 carry (Task 12 Minor 1): buổi nhóm đã chốt được cộng vào số buổi
  // đã đến, còn điểm danh ở buổi bị ẩn thì không.
  it("one exchange check-in plus two completed group sessions is enough to refer", async () => {
    const m = await referrer(1);
    for (const date of ["2019-03-01", "2019-03-02"]) {
      const [s] = await testDb
        .insert(sessions)
        .values({ date, status: "completed" })
        .returning({ id: sessions.id });
      await testDb.insert(sessionAttendees).values({
        sessionId: s.id,
        memberId: m.id,
        isGuest: false,
        attendsPlay: true,
        attendsDine: false,
      });
    }
    const n = await newMember();
    asMember(m);
    expect(await referMember(input(n.publicCode!))).toEqual({ success: true });
    expect(await rowsFor(n.id)).toHaveLength(1);
  });

  it("a check-in at a hidden event does not count: 1 of 3 hidden gets referralNotEligible", async () => {
    const m = await referrer(2);
    await addReg((await mkEvent({ hiddenAt: iso(NOW - DAY) })).id, m.id);
    const n = await newMember();
    asMember(m);
    expect(await referMember(input(n.publicCode!))).toEqual({
      error: "referralNotEligible",
    });
    expect(await rowsFor(n.id)).toHaveLength(0);
  });
});

describe("referral read side", () => {
  it("the profile shows referred true and never the referrer", async () => {
    const r = await referrer();
    const n = await newMember();
    const other = await newMember();
    asMember(r);
    expect((await getPublicProfile(n.publicCode!))?.referred).toBe(false);
    expect(await referMember(input(n.publicCode!))).toEqual({ success: true });
    const profile = await getPublicProfile(n.publicCode!);
    expect(profile?.referred).toBe(true);
    expect(profile?.isNew).toBe(true);
    const json = JSON.stringify(profile);
    expect(json).not.toContain(r.name);
    expect(json).not.toContain(r.publicCode!);
    expect(json).not.toMatch(/referrer/i);
    expect((await getPublicProfile(other.publicCode!))?.referred).toBe(false);
  });

  it("getMyReferralState reports eligibility, use this month and whether the viewer is limited", async () => {
    const r = await referrer();
    const n = await newMember();
    asMember(r);
    expect(await getMyReferralState()).toEqual({
      eligible: true,
      usedThisMonth: 0,
      limit: 5,
      blockedUntil: null,
      limited: false,
    });
    await referMember(input(n.publicCode!));
    expect((await getMyReferralState())?.usedThisMonth).toBe(1);

    asMember(n);
    expect(await getMyReferralState()).toEqual({
      eligible: false,
      usedThisMonth: 0,
      limit: 5,
      blockedUntil: null,
      limited: false,
    });
    const fresh = await newMember();
    asMember(fresh);
    expect((await getMyReferralState())?.limited).toBe(true);

    mocks.flag.mockResolvedValue(false);
    mocks.auth.mockClear();
    expect(await getMyReferralState()).toBeNull();
    expect(mocks.auth).not.toHaveBeenCalled();
    mocks.flag.mockResolvedValue(true);
    mocks.auth.mockResolvedValue({ error: "no" });
    expect(await getMyReferralState()).toBeNull();
  });

  it("ensureMyPublicCode gives a code once, with no Turnstile, after the flag and the account", async () => {
    const m = await newMember({ publicCode: null });
    asMember(m);
    const first = await ensureMyPublicCode();
    expect(first).toEqual({ code: expect.stringMatching(/^[a-z2-9]{10}$/) });
    expect(await ensureMyPublicCode()).toEqual(first);
    expect(mocks.verify).not.toHaveBeenCalled();

    mocks.flag.mockResolvedValue(false);
    mocks.auth.mockClear();
    expect(await ensureMyPublicCode()).toEqual({ error: "notFound" });
    expect(mocks.auth).not.toHaveBeenCalled();

    mocks.flag.mockResolvedValue(true);
    mocks.auth.mockResolvedValue({ error: "no" });
    expect(await ensureMyPublicCode()).toEqual({ error: "no" });
  });
});

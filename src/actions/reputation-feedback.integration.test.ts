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
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import { latestPerRater } from "@/lib/reputation/score";
import {
  exchangeEvents,
  exchangeRegistrations,
  hostFeedback,
  members,
  peerFeedback,
  rateLimitBuckets,
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
// Mặc định chạy checkBotAndRate thật (Turnstile mock + rate limit ghi DB thật).
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

const { db: testDb } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { getEventFeedbackForm, submitEventFeedback } =
  await import("./reputation");

type Member = typeof members.$inferSelect;
const DAY = 86_400_000;
const NOW = Date.parse("2026-11-05T00:00:00.000Z");
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

let seq = 0;
async function newMember(
  over: Partial<typeof members.$inferInsert> = {},
): Promise<Member> {
  seq += 1;
  const [m] = await testDb
    .insert(members)
    .values({
      name: `M${seq}`,
      approvalStatus: "pending",
      avatarKey: "k",
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

async function mkEvent(
  host: Member,
  over: Partial<typeof exchangeEvents.$inferInsert> = {},
) {
  seq += 1;
  const endAt = iso(NOW - DAY);
  const [ev] = await testDb
    .insert(exchangeEvents)
    .values({
      publicCode: `fb${String(seq).padStart(8, "0")}`,
      hostMemberId: host.id,
      venueId: venue.id,
      title: "Giao luu",
      startAt: iso(NOW - DAY - 2 * 3_600_000),
      endAt,
      slotsTotal: 10,
      feeMode: "fixed",
      registerDeadline: iso(NOW - 2 * DAY),
      cancelDeadline: iso(NOW - 2 * DAY),
      status: "done",
      createdAt: iso(NOW - 3 * DAY),
      updatedAt: iso(NOW - 3 * DAY),
      ...over,
    })
    .returning();
  return ev;
}
async function addReg(
  eventId: number,
  memberId: number,
  o: { checkedIn?: boolean; status?: "approved" | "cancelled" } = {},
) {
  const [r] = await testDb
    .insert(exchangeRegistrations)
    .values({
      eventId,
      memberId,
      status: o.status ?? "approved",
      maleCount: 1,
      femaleCount: 0,
      checkedIn: o.checkedIn ?? true,
      createdAt: iso(NOW - 3 * DAY),
      updatedAt: iso(NOW - 3 * DAY),
    })
    .returning();
  return r;
}

/** Buổi đã kết thúc 1 ngày, host + 3 người được điểm danh (A, B, C). */
async function scene() {
  const host = await newMember({ approvalStatus: "approved", name: "Host" });
  const ev = await mkEvent(host);
  const a = await newMember({ name: "A" });
  const b = await newMember({ name: "B" });
  const c = await newMember({ name: "C" });
  const regA = await addReg(ev.id, a.id);
  const regB = await addReg(ev.id, b.id);
  const regC = await addReg(ev.id, c.id);
  return { host, ev, a, b, c, regA, regB, regC };
}

type PeerIn = {
  registrationId: number;
  playAgain?: boolean;
  tags?: string[];
  skill?: string | null;
};
function payload(
  code: string,
  peers: PeerIn[],
  over: Record<string, unknown> = {},
) {
  return {
    code,
    host: { asDescribed: true, feeAsPromised: true },
    peers: peers.map((p) => ({
      registrationId: p.registrationId,
      playAgain: p.playAgain ?? false,
      tags: p.tags ?? [],
      skill: p.skill ?? null,
    })),
    idempotencyKey: randomUUID(),
    turnstileToken: "tok",
    ...over,
  };
}

const peerRows = (eventId: number) =>
  testDb.select().from(peerFeedback).where(eq(peerFeedback.eventId, eventId));
const hostRows = (eventId: number) =>
  testDb.select().from(hostFeedback).where(eq(hostFeedback.eventId, eventId));

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
});

describe("submitEventFeedback: guards", () => {
  it("flag off returns notFound before auth and before Turnstile", async () => {
    const { ev, a, regB } = await scene();
    asMember(a);
    mocks.flag.mockResolvedValue(false);
    const r = await submitEventFeedback(
      payload(ev.publicCode, [{ registrationId: regB.id, playAgain: true }]),
    );
    expect(r).toEqual({ error: "notFound" });
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(await testDb.select().from(rateLimitBuckets)).toHaveLength(0);
    expect(await peerRows(ev.id)).toHaveLength(0);
  });

  it("anonymous submit is rejected before Turnstile", async () => {
    const { ev, regB } = await scene();
    mocks.auth.mockResolvedValue({
      error: "Vui lòng xác nhận danh tính trước",
    });
    const r = await submitEventFeedback(
      payload(ev.publicCode, [{ registrationId: regB.id, playAgain: true }]),
    );
    expect(r).toEqual({ error: "Vui lòng xác nhận danh tính trước" });
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(await testDb.select().from(rateLimitBuckets)).toHaveLength(0);
    expect(await hostRows(ev.id)).toHaveLength(0);
  });

  it("failed Turnstile writes nothing: no rate_limit_buckets row and no feedback row", async () => {
    const { ev, a, regB } = await scene();
    asMember(a);
    mocks.verify.mockResolvedValue({ ok: false, reason: "invalid" });
    const r = await submitEventFeedback(
      payload(ev.publicCode, [{ registrationId: regB.id, playAgain: true }]),
    );
    expect(r).toEqual({ error: "captcha" });
    expect(mocks.verify).toHaveBeenCalledWith(
      "tok",
      expect.objectContaining({ action: "exchange_feedback" }),
    );
    expect(await testDb.select().from(rateLimitBuckets)).toHaveLength(0);
    expect(await peerRows(ev.id)).toHaveLength(0);
    expect(await hostRows(ev.id)).toHaveLength(0);
  });

  it("host answers are mandatory and invalid peer input is rejected before Turnstile", async () => {
    const { ev, a, regB } = await scene();
    asMember(a);
    const bad = [
      { ...payload(ev.publicCode, []), host: undefined },
      { ...payload(ev.publicCode, []), host: { asDescribed: true } },
      payload(ev.publicCode, [
        { registrationId: regB.id, tags: ["on_time", "on_time"] },
      ]),
      payload(ev.publicCode, [{ registrationId: regB.id, tags: ["rude"] }]),
      payload(ev.publicCode, [
        { registrationId: regB.id },
        { registrationId: regB.id },
      ]),
      payload(ev.publicCode, [{ registrationId: regB.id, skill: "pro" }]),
      payload(ev.publicCode, [], { idempotencyKey: "not-a-uuid" }),
      payload(ev.publicCode, [], { turnstileToken: "" }),
    ];
    for (const input of bad) {
      expect(await submitEventFeedback(input)).toEqual({
        error: "invalidInput",
      });
    }
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(await testDb.select().from(rateLimitBuckets)).toHaveLength(0);
  });
});

describe("submitEventFeedback: writes", () => {
  it("checked-in player rates two co-players and the host in one submit; rows carry the rater's weight (1-event rater 1, 7-event rater 5)", async () => {
    const { host, ev, a, b, c, regA, regB, regC } = await scene();
    asMember(a);
    const r = await submitEventFeedback(
      payload(ev.publicCode, [
        {
          registrationId: regB.id,
          playAgain: true,
          tags: ["nice_play", "on_time"],
          skill: "tb",
        },
        { registrationId: regC.id, tags: ["friendly"] },
      ]),
    );
    expect(r).toEqual({ success: true, data: { saved: 3 } });

    const rows = await peerRows(ev.id);
    expect(
      rows
        .map((x) => ({
          from: x.fromMemberId,
          to: x.toMemberId,
          playAgain: x.playAgain,
          tags: JSON.parse(x.tags),
          skill: x.skillLevel,
          w: x.raterWeight,
        }))
        .sort((x, y) => x.to - y.to),
    ).toEqual([
      {
        from: a.id,
        to: b.id,
        playAgain: true,
        // Sắp theo thứ tự PEER_TAGS, không theo thứ tự gửi.
        tags: ["on_time", "nice_play"],
        skill: "tb",
        w: 1,
      },
      {
        from: a.id,
        to: c.id,
        playAgain: false,
        tags: ["friendly"],
        skill: null,
        w: 1,
      },
    ]);
    expect(rows.every((x) => x.createdAt === iso(NOW))).toBe(true);
    const [hf] = await hostRows(ev.id);
    expect(hf).toMatchObject({
      fromMemberId: a.id,
      asDescribed: true,
      feeAsPromised: true,
      raterWeight: 1,
    });
    expect(rows.some((x) => x.toMemberId === host.id)).toBe(false);

    // Người đã đến 7 buổi: trọng số đủ 5.
    for (let i = 0; i < 6; i++) {
      const other = await mkEvent(host);
      await addReg(other.id, b.id);
    }
    asMember(b);
    const rb = await submitEventFeedback(
      payload(ev.publicCode, [{ registrationId: regA.id, playAgain: true }], {
        host: { asDescribed: false, feeAsPromised: true },
      }),
    );
    expect(rb).toEqual({ success: true, data: { saved: 2 } });
    const fromB = (await peerRows(ev.id)).filter(
      (x) => x.fromMemberId === b.id,
    );
    expect(fromB).toHaveLength(1);
    expect(fromB[0].raterWeight).toBe(5);
    const hb = (await hostRows(ev.id)).find((x) => x.fromMemberId === b.id);
    expect(hb).toMatchObject({ asDescribed: false, raterWeight: 5 });
  });

  it("same idempotencyKey again writes nothing, also right after the window closed", async () => {
    const { ev, a, regB } = await scene();
    asMember(a);
    const first = payload(ev.publicCode, [
      { registrationId: regB.id, playAgain: true },
    ]);
    expect(await submitEventFeedback(first)).toEqual({
      success: true,
      data: { saved: 2 },
    });
    const before = await peerRows(ev.id);
    const hostBefore = await hostRows(ev.id);

    vi.setSystemTime(NOW + 60_000);
    // Cùng khoá nhưng nội dung khác: vẫn là lần gửi cũ, không thành lần sửa.
    const again = {
      ...first,
      peers: [
        {
          registrationId: regB.id,
          playAgain: false,
          tags: ["friendly"],
          skill: null,
        },
      ],
    };
    expect(await submitEventFeedback(again)).toEqual({
      success: true,
      data: { saved: 0 },
    });

    // Buổi kết thúc lúc NOW - 1 ngày: cửa sổ đóng đúng lúc NOW + 6 ngày.
    vi.setSystemTime(NOW + 6 * DAY);
    expect(await submitEventFeedback(again)).toEqual({
      success: true,
      data: { saved: 0 },
    });
    expect(await peerRows(ev.id)).toEqual(before);
    expect(await hostRows(ev.id)).toEqual(hostBefore);
  });

  it("a new key updates answers in place, still one row per pair", async () => {
    const { ev, a, regB } = await scene();
    asMember(a);
    await submitEventFeedback(
      payload(ev.publicCode, [{ registrationId: regB.id, playAgain: true }]),
    );
    const [first] = await peerRows(ev.id);
    const [firstHost] = await hostRows(ev.id);

    vi.setSystemTime(NOW + 3_600_000);
    const r = await submitEventFeedback(
      payload(
        ev.publicCode,
        [{ registrationId: regB.id, tags: ["fair_play"], skill: "yeu" }],
        { host: { asDescribed: false, feeAsPromised: false } },
      ),
    );
    expect(r).toEqual({ success: true, data: { saved: 2 } });
    const rows = await peerRows(ev.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: first.id,
      playAgain: false,
      tags: JSON.stringify(["fair_play"]),
      skillLevel: "yeu",
      createdAt: first.createdAt,
      updatedAt: iso(NOW + 3_600_000),
    });
    const hosts = await hostRows(ev.id);
    expect(hosts).toHaveLength(1);
    expect(hosts[0]).toMatchObject({
      id: firstHost.id,
      asDescribed: false,
      feeAsPromised: false,
      createdAt: firstHost.createdAt,
    });
  });

  it("two concurrent submits from two tabs end with one row per pair and one host_feedback row", async () => {
    const { ev, a, regB, regC } = await scene();
    asMember(a);
    // DB file của test mở kết nối mới cho mỗi transaction (không busy_timeout):
    // transaction rate limit chạy cạnh transaction ghi sẽ SQLITE_BUSY, điều
    // Turso thật không gặp (xem src/actions/venues.ts). Bỏ phần ghi rate limit.
    mocks.bot.mockResolvedValue({ ok: true });
    const peers = [
      { registrationId: regB.id, playAgain: true },
      { registrationId: regC.id, tags: ["on_time"] },
    ];
    const results = await Promise.all([
      submitEventFeedback(payload(ev.publicCode, peers)),
      submitEventFeedback(payload(ev.publicCode, peers)),
    ]);
    expect(results.every((r) => "success" in r)).toBe(true);
    expect(await peerRows(ev.id)).toHaveLength(2);
    expect(await hostRows(ev.id)).toHaveLength(1);

    // Cùng khoá ở hai tab: một lần ghi, lần kia trả kết quả cũ.
    const { ev: ev2, a: a2, regB: regB2 } = await scene();
    asMember(a2);
    const same = payload(ev2.publicCode, [
      { registrationId: regB2.id, playAgain: true },
    ]);
    const twice = await Promise.all([
      submitEventFeedback(same),
      submitEventFeedback(same),
    ]);
    expect(
      twice.map((r) => ("success" in r ? r.data.saved : -1)).sort(),
    ).toEqual([0, 2]);
    expect(await peerRows(ev2.id)).toHaveLength(1);
    expect(await hostRows(ev2.id)).toHaveLength(1);
  });

  it("editing only the host answers keeps the peer row's timestamp, so the aggregate still uses the newer event's row", async () => {
    const host = await newMember({ approvalStatus: "approved" });
    const a = await newMember();
    const x = await newMember();
    const e1 = await mkEvent(host);
    const e2 = await mkEvent(host);
    await addReg(e1.id, a.id);
    const x1 = await addReg(e1.id, x.id);
    await addReg(e2.id, a.id);
    const x2 = await addReg(e2.id, x.id);
    asMember(a);

    await submitEventFeedback(
      payload(e1.publicCode, [{ registrationId: x1.id, playAgain: true }]),
    );
    vi.setSystemTime(NOW + 3_600_000);
    await submitEventFeedback(
      payload(e2.publicCode, [{ registrationId: x2.id, tags: ["on_time"] }]),
    );
    const [e1Before] = await peerRows(e1.id);
    const [e1HostBefore] = await hostRows(e1.id);

    vi.setSystemTime(NOW + 2 * 3_600_000);
    const r = await submitEventFeedback(
      payload(e1.publicCode, [{ registrationId: x1.id, playAgain: true }], {
        host: { asDescribed: false, feeAsPromised: true },
      }),
    );
    expect(r).toEqual({ success: true, data: { saved: 2 } });

    const [e1After] = await peerRows(e1.id);
    expect(e1After).toEqual(e1Before);
    const [e1HostAfter] = await hostRows(e1.id);
    expect(e1HostAfter).toMatchObject({
      asDescribed: false,
      updatedAt: iso(NOW + 2 * 3_600_000),
    });
    expect(e1HostAfter.idempotencyKey).not.toBe(e1HostBefore.idempotencyKey);

    // Bước "mỗi người chấm chỉ lấy dòng mới nhất" của phần tổng hợp.
    const toX = await testDb
      .select()
      .from(peerFeedback)
      .where(eq(peerFeedback.toMemberId, x.id));
    const kept = latestPerRater(
      toX.map((row) => ({
        id: row.id,
        fromId: row.fromMemberId,
        updatedAt: row.updatedAt,
        eventId: row.eventId,
      })),
    );
    expect(kept.map((k) => k.eventId)).toEqual([e2.id]);
  });

  it("editing only the peer answers keeps the host row's timestamp and weight but stores the new key", async () => {
    const { ev, a, regB } = await scene();
    asMember(a);
    await submitEventFeedback(
      payload(ev.publicCode, [{ registrationId: regB.id, playAgain: true }]),
    );
    const [hostBefore] = await hostRows(ev.id);

    vi.setSystemTime(NOW + 3_600_000);
    const again = payload(ev.publicCode, [
      { registrationId: regB.id, tags: ["friendly"] },
    ]);
    await submitEventFeedback(again);
    const [hostAfter] = await hostRows(ev.id);
    expect(hostAfter).toEqual({
      ...hostBefore,
      idempotencyKey: again.idempotencyKey,
    });
    const [peerAfter] = await peerRows(ev.id);
    expect(peerAfter.updatedAt).toBe(iso(NOW + 3_600_000));

    // Gửi lại cùng key vẫn là lần gửi lặp, không ghi gì.
    vi.setSystemTime(NOW + 2 * 3_600_000);
    expect(await submitEventFeedback(again)).toEqual({
      success: true,
      data: { saved: 0 },
    });
  });

  it("clearing every answer for a co-player deletes that row", async () => {
    const { ev, a, b, c, regB, regC } = await scene();
    asMember(a);
    await submitEventFeedback(
      payload(ev.publicCode, [
        { registrationId: regB.id, playAgain: true },
        { registrationId: regC.id, tags: ["friendly"] },
      ]),
    );
    expect(await peerRows(ev.id)).toHaveLength(2);

    const r = await submitEventFeedback(
      payload(ev.publicCode, [
        { registrationId: regB.id },
        { registrationId: regC.id, tags: ["friendly"] },
      ]),
    );
    expect(r).toEqual({ success: true, data: { saved: 2 } });
    const rows = await peerRows(ev.id);
    expect(rows.map((x) => x.toMemberId)).toEqual([c.id]);
    expect(rows.some((x) => x.toMemberId === b.id)).toBe(false);
  });

  it("a registration of another event, the viewer's own, one not checked in, or a made-up id rejects the whole submit and writes no row", async () => {
    const { host, ev, a, regA, regB } = await scene();
    const other = await mkEvent(host);
    const elsewhere = await addReg(other.id, (await newMember()).id);
    const notChecked = await addReg(ev.id, (await newMember()).id, {
      checkedIn: false,
    });
    asMember(a);
    for (const bad of [elsewhere.id, regA.id, notChecked.id, 999_999]) {
      const r = await submitEventFeedback(
        payload(ev.publicCode, [
          { registrationId: regB.id, playAgain: true },
          { registrationId: bad, playAgain: true },
        ]),
      );
      expect(r).toEqual({
        error: "invalidInput",
      });
    }
    expect(await peerRows(ev.id)).toHaveLength(0);
    expect(await hostRows(ev.id)).toHaveLength(0);
  });

  it("a locked or rejected co-player is not rateable: not in the form, and a submit naming them is rejected", async () => {
    const { ev, a, regB } = await scene();
    const locked = await newMember({ name: "Locked", isActive: false });
    const rejected = await newMember({
      name: "Rejected",
      approvalStatus: "rejected",
    });
    const regLocked = await addReg(ev.id, locked.id);
    const regRejected = await addReg(ev.id, rejected.id);
    asMember(a);

    const form = await getEventFeedbackForm(ev.publicCode);
    if (!("success" in form)) throw new Error("form failed");
    const ids = form.data.peers.map((p) => p.registrationId);
    expect(ids).toContain(regB.id);
    expect(ids).not.toContain(regLocked.id);
    expect(ids).not.toContain(regRejected.id);

    for (const bad of [regLocked.id, regRejected.id]) {
      const r = await submitEventFeedback(
        payload(ev.publicCode, [
          { registrationId: regB.id, playAgain: true },
          { registrationId: bad, playAgain: true },
        ]),
      );
      expect(r).toEqual({
        error: "invalidInput",
      });
    }
    expect(await peerRows(ev.id)).toHaveLength(0);
  });

  it("the host cannot submit and is never a peer", async () => {
    const { host, ev, a } = await scene();
    // Hàng rào ở DB: kể cả có dòng đăng ký của host.
    const hostReg = await addReg(ev.id, host.id);
    asMember(host);
    expect(await submitEventFeedback(payload(ev.publicCode, []))).toEqual({
      error: "feedbackNotAllowed",
    });
    expect(await hostRows(ev.id)).toHaveLength(0);

    asMember(a);
    const form = await getEventFeedbackForm(ev.publicCode);
    if (!("success" in form)) throw new Error("form failed");
    expect(form.data.peers.map((p) => p.name)).not.toContain("Host");
    const r = await submitEventFeedback(
      payload(ev.publicCode, [{ registrationId: hostReg.id, playAgain: true }]),
    );
    expect(r).toEqual({
      error: "invalidInput",
    });
    expect(await peerRows(ev.id)).toHaveLength(0);
  });

  it("before endAt feedbackNotYet; 1 ms after endAt plus 7 days feedbackClosed; hidden or cancelled event feedbackNotFound", async () => {
    const { host, a } = await scene();
    const future = await mkEvent(host, { endAt: iso(NOW + 3_600_000) });
    await addReg(future.id, a.id);
    asMember(a);
    expect(await submitEventFeedback(payload(future.publicCode, []))).toEqual({
      error: "feedbackNotYet",
    });

    const old = await mkEvent(host, { endAt: iso(NOW - 7 * DAY - 1) });
    await addReg(old.id, a.id);
    expect(await submitEventFeedback(payload(old.publicCode, []))).toEqual({
      error: "feedbackClosed",
    });

    // Đúng mốc endAt + 7 ngày cũng đã đóng (ctx.state).
    const edge = await mkEvent(host, { endAt: iso(NOW - 7 * DAY) });
    await addReg(edge.id, a.id);
    expect(await submitEventFeedback(payload(edge.publicCode, []))).toEqual({
      error: "feedbackClosed",
    });

    const hidden = await mkEvent(host, { hiddenAt: iso(NOW - DAY) });
    await addReg(hidden.id, a.id);
    const cancelled = await mkEvent(host, { status: "cancelled" });
    await addReg(cancelled.id, a.id);
    for (const code of [hidden.publicCode, cancelled.publicCode, "nosuch"]) {
      expect(await submitEventFeedback(payload(code, []))).toEqual({
        error: "feedbackNotFound",
      });
    }
    for (const id of [future.id, old.id, edge.id, hidden.id, cancelled.id])
      expect(await hostRows(id)).toHaveLength(0);
  });

  it("a viewer registered but not checked in cannot submit", async () => {
    const { ev } = await scene();
    const late = await newMember();
    await addReg(ev.id, late.id, { checkedIn: false });
    asMember(late);
    expect(await submitEventFeedback(payload(ev.publicCode, []))).toEqual({
      error: "feedbackNotAllowed",
    });
    expect(await hostRows(ev.id)).toHaveLength(0);
  });

  it("submit never calls updateTag", async () => {
    const { ev, a, regB } = await scene();
    asMember(a);
    const r = await submitEventFeedback(
      payload(ev.publicCode, [{ registrationId: regB.id, playAgain: true }]),
    );
    expect("success" in r).toBe(true);
    expect(mocks.updateTag).not.toHaveBeenCalled();
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("getEventFeedbackForm", () => {
  it("the form returns only the viewer's own answers and no member id", async () => {
    const { host, ev, a, b, regA, regB, regC } = await scene();
    await testDb
      .update(members)
      .set({ publicCode: "hostcode01" })
      .where(eq(members.id, host.id));
    asMember(a);
    await submitEventFeedback(
      payload(
        ev.publicCode,
        [{ registrationId: regC.id, playAgain: true, tags: ["friendly"] }],
        { host: { asDescribed: true, feeAsPromised: false } },
      ),
    );
    asMember(b);
    await submitEventFeedback(
      payload(ev.publicCode, [
        { registrationId: regC.id, tags: ["fair_play"], skill: "tbk" },
        { registrationId: regA.id, playAgain: true },
      ]),
    );

    asMember(a);
    const r = await getEventFeedbackForm(ev.publicCode);
    expect(r).toEqual({
      success: true,
      data: {
        state: "open",
        closesAt: iso(Date.parse(ev.endAt) + 7 * DAY),
        host: {
          name: "Host",
          avatarUrl: null,
          avatarKey: "k",
          code: "hostcode01",
        },
        hostAnswer: { asDescribed: true, feeAsPromised: false },
        peers: [
          {
            registrationId: regB.id,
            name: "B",
            avatarUrl: null,
            avatarKey: "k",
            code: null,
            mine: null,
          },
          {
            registrationId: regC.id,
            name: "C",
            avatarUrl: null,
            avatarKey: "k",
            code: null,
            mine: { playAgain: true, tags: ["friendly"], skill: null },
          },
        ],
      },
    });
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/memberId|fromMember|toMember|raterWeight/);
    expect(json).not.toContain("fair_play");
    expect(json).not.toContain(`"id":`);
  });

  it("a viewer not checked in gets notEligible with no names", async () => {
    const { ev } = await scene();
    const late = await newMember();
    await addReg(ev.id, late.id, { checkedIn: false });
    const stranger = await newMember();
    for (const viewer of [late, stranger]) {
      asMember(viewer);
      const r = await getEventFeedbackForm(ev.publicCode);
      if (!("success" in r)) throw new Error("form failed");
      expect(r.data.state).toBe("notEligible");
      expect(r.data.peers).toEqual([]);
      expect(r.data.hostAnswer).toBeNull();
      const json = JSON.stringify(r);
      for (const name of ['"A"', '"B"', '"C"'])
        expect(json).not.toContain(name);
    }
  });

  it("the form is notFound when the flag is off, an error when signed out, and feedbackNotFound for a hidden event", async () => {
    const { host, ev, a } = await scene();
    mocks.flag.mockResolvedValue(false);
    asMember(a);
    expect(await getEventFeedbackForm(ev.publicCode)).toEqual({
      error: "notFound",
    });
    expect(mocks.auth).not.toHaveBeenCalled();

    mocks.flag.mockResolvedValue(true);
    mocks.auth.mockResolvedValue({
      error: "Vui lòng xác nhận danh tính trước",
    });
    expect(await getEventFeedbackForm(ev.publicCode)).toEqual({
      error: "Vui lòng xác nhận danh tính trước",
    });

    asMember(a);
    const hidden = await mkEvent(host, { hiddenAt: iso(NOW) });
    await addReg(hidden.id, a.id);
    expect(await getEventFeedbackForm(hidden.publicCode)).toEqual({
      error: "feedbackNotFound",
    });
  });

  it("the form reports notYet and closed with the viewer's peers still listed", async () => {
    const { host, a } = await scene();
    const future = await mkEvent(host, { endAt: iso(NOW + 3_600_000) });
    await addReg(future.id, a.id);
    const peer = await newMember({ name: "P" });
    await addReg(future.id, peer.id);
    asMember(a);
    const r = await getEventFeedbackForm(future.publicCode);
    if (!("success" in r)) throw new Error("form failed");
    expect(r.data.state).toBe("notYet");
    expect(r.data.peers.map((p) => p.name)).toEqual(["P"]);

    vi.setSystemTime(NOW + 3_600_000 + 7 * DAY);
    const closed = await getEventFeedbackForm(future.publicCode);
    if (!("success" in closed)) throw new Error("form failed");
    expect(closed.data.state).toBe("closed");
  });
});

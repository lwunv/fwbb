import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  abuseReports,
  admins,
  exchangeEvents,
  exchangeRegistrations,
  notifications,
  venues,
  members,
} from "@/db/schema";
import { eq } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  flag: vi.fn(),
  auth: vi.fn(),
  bot: vi.fn(),
}));
vi.mock("@/lib/exchange-flag", () => ({ isExchangeEnabled: mocks.flag }));
vi.mock("@/lib/member-auth", () => ({
  requireExchangeMember: mocks.auth,
}));
vi.mock("@/lib/exchange/guards", async (orig) => ({
  ...(await orig<typeof import("@/lib/exchange/guards")>()),
  checkBotAndRate: mocks.bot,
}));

const { db: testDb } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { reportAbuse } = await import("./exchange-reports");
const { enableNotificationsForTest } =
  await import("@/lib/notifications/test-helpers");

type Member = typeof members.$inferSelect;
const DAY = 86_400_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const [venue] = await testDb
  .insert(venues)
  .values({ name: "V", lat: 10, lng: 106, status: "approved" })
  .returning();
const [host] = await testDb
  .insert(members)
  .values({ name: "Host", approvalStatus: "approved" })
  .returning();
await testDb
  .insert(admins)
  .values({ username: "sa1", passwordHash: "x", role: "superadmin" });

let seq = 0;
async function newMember(
  over: Partial<typeof members.$inferInsert> = {},
): Promise<Member> {
  seq += 1;
  const [m] = await testDb
    .insert(members)
    .values({ name: `M${seq}`, approvalStatus: "approved", ...over })
    .returning();
  return m;
}
function asMember(m: Member) {
  mocks.auth.mockResolvedValue({
    user: { memberId: m.id, externalId: "x" },
    member: m,
  });
}

let codeSeq = 0;
async function mkEvent(over: Partial<typeof exchangeEvents.$inferInsert> = {}) {
  codeSeq += 1;
  const [ev] = await testDb
    .insert(exchangeEvents)
    .values({
      publicCode: `rep${codeSeq}`,
      hostMemberId: host.id,
      venueId: venue.id,
      title: "Giao luu",
      startAt: iso(10 * DAY),
      endAt: iso(10 * DAY + 2 * 3_600_000),
      slotsTotal: 4,
      feeMode: "fixed",
      feeAmountMale: 50000,
      registerDeadline: iso(9 * DAY),
      cancelDeadline: iso(8 * DAY),
      status: "open",
      createdAt: iso(0),
      updatedAt: iso(0),
      ...over,
    })
    .returning();
  return ev;
}
async function addReg(eventId: number, memberId: number) {
  const [r] = await testDb
    .insert(exchangeRegistrations)
    .values({
      eventId,
      memberId,
      status: "approved",
      maleCount: 1,
      femaleCount: 0,
      createdAt: iso(0),
      updatedAt: iso(0),
    })
    .returning();
  return r;
}

const rep = (target: unknown, over: Record<string, unknown> = {}) => ({
  target,
  reason: "spam",
  turnstileToken: "tok",
  ...over,
});
const allReports = () => testDb.select().from(abuseReports);
const reportNotices = () =>
  testDb
    .select()
    .from(notifications)
    .where(eq(notifications.kind, "exchange_reported"));

beforeEach(async () => {
  await testDb.delete(notifications);
  await testDb.delete(abuseReports);
  await testDb.delete(exchangeRegistrations);
  await testDb.delete(exchangeEvents);
  await enableNotificationsForTest(testDb);
  mocks.flag.mockReset().mockResolvedValue(true);
  mocks.bot.mockReset().mockResolvedValue({ ok: true });
  mocks.auth.mockReset();
});

describe("reportAbuse", () => {
  it("reports an event and the host by code, mapped server-side", async () => {
    const ev = await mkEvent();
    const me = await newMember({ approvalStatus: "pending" });
    asMember(me);
    expect(
      await reportAbuse(rep({ type: "event", code: ev.publicCode })),
    ).toEqual({ success: true });
    expect(
      await reportAbuse(rep({ type: "host", code: ev.publicCode })),
    ).toEqual({ success: true });
    const rows = await allReports();
    expect(
      rows.map((r) => [r.targetType, r.targetId, r.reporterMemberId]).sort(),
    ).toEqual(
      [
        ["event", ev.id, me.id],
        ["member", host.id, me.id],
      ].sort(),
    );
  });

  it("registration target by a non-host rejected", async () => {
    const ev = await mkEvent();
    const victim = await newMember();
    const reg = await addReg(ev.id, victim.id);
    const stranger = await newMember();
    asMember(stranger);
    const res = await reportAbuse(
      rep({ type: "registration", registrationId: reg.id }),
    );
    expect("error" in res).toBe(true);
    expect(await allReports()).toHaveLength(0);
  });

  it("host can report one of their registrants", async () => {
    const ev = await mkEvent();
    const victim = await newMember();
    const reg = await addReg(ev.id, victim.id);
    asMember(host);
    expect(
      await reportAbuse(
        rep(
          { type: "registration", registrationId: reg.id },
          { reason: "no_show" },
        ),
      ),
    ).toEqual({ success: true });
    const [r] = await allReports();
    expect(r).toMatchObject({ targetType: "member", targetId: victim.id });
  });

  it("second report of the same target writes nothing", async () => {
    const ev = await mkEvent();
    asMember(await newMember());
    const target = { type: "event", code: ev.publicCode };
    expect(await reportAbuse(rep(target))).toEqual({ success: true });
    expect(await reportAbuse(rep(target, { reason: "abusive" }))).toEqual({
      success: true,
    });
    expect(await allReports()).toHaveLength(1);
    expect(await reportNotices()).toHaveLength(1);
  });

  it("no Turnstile, no row", async () => {
    const ev = await mkEvent();
    asMember(await newMember());
    mocks.bot.mockResolvedValue({ error: "captcha" });
    const res = await reportAbuse(rep({ type: "event", code: ev.publicCode }));
    expect(res).toEqual({ error: "captcha" });
    expect(await allReports()).toHaveLength(0);
  });

  it("admin gets one exchange_reported notice", async () => {
    const ev = await mkEvent();
    asMember(await newMember());
    await reportAbuse(rep({ type: "event", code: ev.publicCode }));
    const notices = await reportNotices();
    expect(notices).toHaveLength(1);
    expect(notices[0].recipientType).toBe("admin");
  });

  it("cannot report yourself", async () => {
    const ev = await mkEvent();
    asMember(host);
    const res = await reportAbuse(rep({ type: "host", code: ev.publicCode }));
    expect("error" in res).toBe(true);
    expect(await allReports()).toHaveLength(0);
  });

  it("hidden event: stranger gets not found, registrant may report", async () => {
    const ev = await mkEvent({ hiddenAt: iso(-1000) });
    const stranger = await newMember();
    asMember(stranger);
    const res = await reportAbuse(rep({ type: "event", code: ev.publicCode }));
    expect("error" in res).toBe(true);
    expect(await allReports()).toHaveLength(0);
    const guest = await newMember();
    await addReg(ev.id, guest.id);
    asMember(guest);
    expect(
      await reportAbuse(rep({ type: "event", code: ev.publicCode })),
    ).toEqual({ success: true });
  });

  it("rejects bad input and a flag that is off, before auth", async () => {
    const ev = await mkEvent();
    asMember(await newMember());
    const target = { type: "event", code: ev.publicCode };
    expect(
      "error" in (await reportAbuse(rep(target, { note: "x".repeat(501) }))),
    ).toBe(true);
    expect(
      "error" in (await reportAbuse(rep(target, { reason: "nope" }))),
    ).toBe(true);
    mocks.flag.mockResolvedValue(false);
    mocks.auth.mockClear();
    expect("error" in (await reportAbuse(rep(target)))).toBe(true);
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(await allReports()).toHaveLength(0);
  });
});

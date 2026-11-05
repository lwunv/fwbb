import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  exchangeEvents,
  exchangeRegistrations,
  financialTransactions,
  hostBlocks,
  notifications,
  sessionDebts,
  venues,
  members,
} from "@/db/schema";
import { eq } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  flag: vi.fn(),
  auth: vi.fn(),
  bot: vi.fn(),
  updateTag: vi.fn(),
}));
vi.mock("@/lib/exchange-flag", () => ({ isExchangeEnabled: mocks.flag }));
vi.mock("@/lib/member-auth", () => ({
  requireExchangeMember: mocks.auth,
}));
vi.mock("next/cache", () => ({
  updateTag: mocks.updateTag,
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("@/lib/exchange/guards", async (orig) => ({
  ...(await orig<typeof import("@/lib/exchange/guards")>()),
  checkBotAndRate: mocks.bot,
}));

const { db: testDb } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { registerForExchange, cancelMyRegistration } =
  await import("./exchange-registrations");
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

function asMember(m: Member | null) {
  mocks.auth.mockResolvedValue(
    m
      ? { user: { memberId: m.id, externalId: "x" }, member: m }
      : { error: "no" },
  );
}

let codeSeq = 0;
async function mkEvent(over: Partial<typeof exchangeEvents.$inferInsert> = {}) {
  codeSeq += 1;
  const [ev] = await testDb
    .insert(exchangeEvents)
    .values({
      publicCode: `code${codeSeq}`,
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

async function addReg(
  eventId: number,
  memberId: number,
  status: (typeof exchangeRegistrations.$inferInsert)["status"],
  male: number,
  female: number,
  waitlistPos: number | null = null,
) {
  const [r] = await testDb
    .insert(exchangeRegistrations)
    .values({
      eventId,
      memberId,
      status,
      maleCount: male,
      femaleCount: female,
      waitlistPos,
      createdAt: iso(0),
      updatedAt: iso(0),
    })
    .returning();
  return r;
}

const input = (code: string, over: Record<string, unknown> = {}) => ({
  code,
  maleCount: 1,
  femaleCount: 0,
  turnstileToken: "tok",
  ...over,
});

async function regOf(eventId: number, memberId: number) {
  const rows = await testDb
    .select()
    .from(exchangeRegistrations)
    .where(eq(exchangeRegistrations.eventId, eventId));
  return rows.filter((r) => r.memberId === memberId);
}

beforeEach(async () => {
  await testDb.delete(notifications);
  await testDb.delete(exchangeRegistrations);
  await testDb.delete(hostBlocks);
  await testDb.delete(exchangeEvents);
  await testDb
    .update(members)
    .set({ isActive: true, approvalStatus: "approved" })
    .where(eq(members.id, host.id));
  mocks.flag.mockReset().mockResolvedValue(true);
  mocks.bot.mockReset().mockResolvedValue({ ok: true });
  mocks.auth.mockReset();
  mocks.updateTag.mockClear();
});

describe("registerForExchange", () => {
  it("auto-approve → approved; manual → pending; full → waitlist pos 1", async () => {
    const auto = await mkEvent({ autoApprove: true, slotsTotal: 1 });
    const manual = await mkEvent({ autoApprove: false });
    const a = await newMember();
    const b = await newMember();
    asMember(a);
    expect(await registerForExchange(input(auto.publicCode))).toEqual({
      success: true,
      data: { status: "approved", waitlistPos: null },
    });
    expect(mocks.updateTag).toHaveBeenCalledWith("exchange");
    asMember(b);
    expect(await registerForExchange(input(auto.publicCode))).toEqual({
      success: true,
      data: { status: "waitlist", waitlistPos: 1 },
    });
    expect(await registerForExchange(input(manual.publicCode))).toEqual({
      success: true,
      data: { status: "pending", waitlistPos: null },
    });
    const [ev] = await testDb
      .select()
      .from(exchangeEvents)
      .where(eq(exchangeEvents.id, auto.id));
    expect(ev.status).toBe("full");
    expect(mocks.bot).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "exchange_register",
        rateKey: `exchange-register:${b.id}`,
      }),
    );
  });

  it("deposit event is never auto-approved (R1)", async () => {
    const ev = await mkEvent({ autoApprove: true, depositAmount: 10000 });
    const a = await newMember();
    asMember(a);
    expect(await registerForExchange(input(ev.publicCode))).toMatchObject({
      data: { status: "pending" },
    });
  });

  it("two concurrent registrations for the last slot → one holds it, one waitlisted", async () => {
    const ev = await mkEvent({ autoApprove: true, slotsTotal: 1 });
    const a = await newMember();
    const b = await newMember();
    // Auth is per call: the mock resolves by call order.
    mocks.auth
      .mockResolvedValueOnce({
        user: { memberId: a.id, externalId: "x" },
        member: a,
      })
      .mockResolvedValueOnce({
        user: { memberId: b.id, externalId: "x" },
        member: b,
      });
    const [r1, r2] = await Promise.all([
      registerForExchange(input(ev.publicCode)),
      registerForExchange(input(ev.publicCode)),
    ]);
    const statuses = [r1, r2]
      .map((r) => ("data" in r ? r.data.status : "error"))
      .sort();
    expect(statuses).toEqual(["approved", "waitlist"]);
    const rows = await testDb
      .select()
      .from(exchangeRegistrations)
      .where(eq(exchangeRegistrations.eventId, ev.id));
    expect(rows).toHaveLength(2);
  });

  it("same member twice → same status, one row", async () => {
    const ev = await mkEvent({ autoApprove: true });
    const a = await newMember();
    asMember(a);
    const r1 = await registerForExchange(input(ev.publicCode));
    const r2 = await registerForExchange(input(ev.publicCode));
    expect(r2).toEqual(r1);
    expect(await regOf(ev.id, a.id)).toHaveLength(1);
  });

  it("cancelled registration is reused, rejected is refused", async () => {
    const ev = await mkEvent({ autoApprove: true });
    const a = await newMember();
    const b = await newMember();
    await addReg(ev.id, a.id, "cancelled", 1, 0);
    await addReg(ev.id, b.id, "rejected", 1, 0);
    asMember(a);
    expect(await registerForExchange(input(ev.publicCode))).toMatchObject({
      data: { status: "approved" },
    });
    expect(await regOf(ev.id, a.id)).toHaveLength(1);
    asMember(b);
    expect(await registerForExchange(input(ev.publicCode))).toEqual({
      error: "cannotRegister",
    });
  });

  it("host cannot register; blocked member gets the generic error", async () => {
    const ev = await mkEvent({ autoApprove: true });
    asMember(host);
    expect(await registerForExchange(input(ev.publicCode))).toEqual({
      error: "cannotRegister",
    });
    const bad = await newMember();
    await testDb.insert(hostBlocks).values({
      hostMemberId: host.id,
      blockedMemberId: bad.id,
      createdAt: iso(0),
    });
    asMember(bad);
    expect(await registerForExchange(input(ev.publicCode))).toEqual({
      error: "cannotRegister",
    });
    expect(await regOf(ev.id, bad.id)).toHaveLength(0);
  });

  it("companions need allowPlusOnes", async () => {
    const no = await mkEvent({ allowPlusOnes: false });
    const yes = await mkEvent({ allowPlusOnes: true });
    const a = await newMember();
    asMember(a);
    expect(
      await registerForExchange(input(no.publicCode, { maleCount: 2 })),
    ).toEqual({ error: "cannotRegister" });
    expect(
      await registerForExchange(input(yes.publicCode, { maleCount: 2 })),
    ).toMatchObject({ success: true });
  });

  it("new account: no companions, no third waiting registration", async () => {
    const plus = await mkEvent({ allowPlusOnes: true });
    const e1 = await mkEvent();
    const e2 = await mkEvent();
    const e3 = await mkEvent();
    const n = await newMember({ approvalStatus: "pending" });
    asMember(n);
    expect(
      await registerForExchange(input(plus.publicCode, { maleCount: 2 })),
    ).toEqual({ error: "cannotRegister" });
    expect(await registerForExchange(input(e1.publicCode))).toMatchObject({
      success: true,
    });
    expect(await registerForExchange(input(e2.publicCode))).toMatchObject({
      success: true,
    });
    expect(await registerForExchange(input(e3.publicCode))).toEqual({
      error: "newAccountLimit",
    });
  });

  it("after registerDeadline rejected (TZ=UTC)", async () => {
    const prev = process.env.TZ;
    process.env.TZ = "UTC";
    try {
      const ev = await mkEvent({ registerDeadline: iso(-60_000) });
      const a = await newMember();
      asMember(a);
      expect(await registerForExchange(input(ev.publicCode))).toEqual({
        error: "deadlinePassed",
      });
      const ok = await mkEvent({ registerDeadline: iso(60_000) });
      expect(await registerForExchange(input(ok.publicCode))).toMatchObject({
        success: true,
      });
    } finally {
      if (prev === undefined) delete process.env.TZ;
      else process.env.TZ = prev;
    }
  });

  it("male waitlisted when only female-reserved slots remain, female gets in", async () => {
    const ev = await mkEvent({
      autoApprove: true,
      slotsTotal: 4,
      femaleReservedSlots: 2,
      reserveReleaseAt: null,
    });
    const m1 = await newMember();
    const m2 = await newMember();
    await addReg(ev.id, m1.id, "approved", 1, 0);
    await addReg(ev.id, m2.id, "approved", 1, 0);
    const male = await newMember();
    const female = await newMember();
    asMember(male);
    expect(await registerForExchange(input(ev.publicCode))).toMatchObject({
      data: { status: "waitlist", waitlistPos: 1 },
    });
    asMember(female);
    expect(
      await registerForExchange(
        input(ev.publicCode, { maleCount: 0, femaleCount: 1 }),
      ),
    ).toMatchObject({ data: { status: "approved" } });
  });

  it("register after reserveReleaseAt promotes the waiting male before seating a newcomer", async () => {
    const ev = await mkEvent({
      autoApprove: true,
      slotsTotal: 3,
      femaleReservedSlots: 1,
      reserveReleaseAt: iso(-60_000),
    });
    const m1 = await newMember();
    const m2 = await newMember();
    const waiting = await newMember();
    await addReg(ev.id, m1.id, "approved", 1, 0);
    await addReg(ev.id, m2.id, "approved", 1, 0);
    await addReg(ev.id, waiting.id, "waitlist", 1, 0, 1);
    const newcomer = await newMember();
    asMember(newcomer);
    expect(await registerForExchange(input(ev.publicCode))).toEqual({
      success: true,
      data: { status: "waitlist", waitlistPos: 1 },
    });
    const [w] = await regOf(ev.id, waiting.id);
    expect(w.status).toBe("approved");
    expect(w.waitlistPos).toBeNull();
    expect(w.decidedAt).not.toBeNull();
  });

  it("deactivated host's event refuses registration", async () => {
    const ev = await mkEvent({ autoApprove: true });
    await testDb
      .update(members)
      .set({ isActive: false })
      .where(eq(members.id, host.id));
    const a = await newMember();
    asMember(a);
    expect(await registerForExchange(input(ev.publicCode))).toEqual({
      error: "eventClosed",
    });
  });

  it("pending exchange account can register; rejected cannot", async () => {
    const ev = await mkEvent({ autoApprove: true });
    const p = await newMember({ approvalStatus: "pending" });
    asMember(p);
    expect(await registerForExchange(input(ev.publicCode))).toMatchObject({
      success: true,
    });
    asMember(null);
    const before = mocks.bot.mock.calls.length;
    expect(await registerForExchange(input(ev.publicCode))).toHaveProperty(
      "error",
    );
    expect(mocks.bot.mock.calls.length).toBe(before);
  });

  it("notifies the host of a new registration", async () => {
    await enableNotificationsForTest(testDb);
    const ev = await mkEvent({ autoApprove: true });
    const a = await newMember();
    asMember(a);
    await registerForExchange(input(ev.publicCode));
    const rows = await testDb.select().from(notifications);
    expect(rows.map((r) => [r.kind, r.recipientId])).toEqual([
      ["exchange_registration_received", host.id],
    ]);
  });

  it("invalid heads rejected before Turnstile", async () => {
    const ev = await mkEvent();
    const a = await newMember();
    asMember(a);
    const before = mocks.bot.mock.calls.length;
    expect(
      await registerForExchange(
        input(ev.publicCode, { maleCount: 0, femaleCount: 0 }),
      ),
    ).toEqual({ error: "invalidInput" });
    expect(mocks.bot.mock.calls.length).toBe(before);
  });
});

describe("cancelMyRegistration", () => {
  it("cancel: late after cancelDeadline, plain before", async () => {
    const late = await mkEvent({ cancelDeadline: iso(-60_000) });
    const early = await mkEvent();
    const a = await newMember();
    await addReg(late.id, a.id, "approved", 1, 0);
    await addReg(early.id, a.id, "approved", 1, 0);
    asMember(a);
    expect(await cancelMyRegistration({ code: late.publicCode })).toEqual({
      success: true,
    });
    expect(await cancelMyRegistration({ code: early.publicCode })).toEqual({
      success: true,
    });
    const [l] = await regOf(late.id, a.id);
    const [e] = await regOf(early.id, a.id);
    expect(l.status).toBe("late_cancelled");
    expect(e.status).toBe("cancelled");
    expect(e.cancelledAt).not.toBeNull();
    expect(e.waitlistPos).toBeNull();
  });

  it("a waitlisted registration cancels plainly even after cancelDeadline", async () => {
    const ev = await mkEvent({ cancelDeadline: iso(-60_000) });
    const a = await newMember();
    await addReg(ev.id, a.id, "waitlist", 1, 0, 1);
    asMember(a);
    await cancelMyRegistration({ code: ev.publicCode });
    expect((await regOf(ev.id, a.id))[0].status).toBe("cancelled");
  });

  it("cancel frees slots and promotes first-fit in the same transaction", async () => {
    await enableNotificationsForTest(testDb);
    const ev = await mkEvent({
      autoApprove: true,
      slotsTotal: 2,
      status: "full",
    });
    const a = await newMember();
    const b = await newMember();
    const w1 = await newMember();
    const w2 = await newMember();
    await addReg(ev.id, a.id, "approved", 1, 0);
    await addReg(ev.id, b.id, "approved", 1, 0);
    // First in line needs 2 heads (does not fit one freed slot), second needs 1.
    await addReg(ev.id, w1.id, "waitlist", 2, 0, 1);
    await addReg(ev.id, w2.id, "waitlist", 1, 0, 2);
    asMember(a);
    expect(await cancelMyRegistration({ code: ev.publicCode })).toEqual({
      success: true,
    });
    expect((await regOf(ev.id, w1.id))[0].status).toBe("waitlist");
    expect((await regOf(ev.id, w2.id))[0]).toMatchObject({
      status: "approved",
      waitlistPos: null,
    });
    const [after] = await testDb
      .select()
      .from(exchangeEvents)
      .where(eq(exchangeEvents.id, ev.id));
    expect(after.status).toBe("full");
    const kinds = (await testDb.select().from(notifications)).map(
      (n) => n.kind,
    );
    expect(kinds).toContain("exchange_registration_cancelled");
    expect(kinds).toContain("exchange_waitlist_promoted");
    expect(mocks.updateTag).toHaveBeenCalledWith("exchange");
  });

  it("cancel reopens a full event when nobody on the waitlist fits", async () => {
    const ev = await mkEvent({ slotsTotal: 1, status: "full" });
    const a = await newMember();
    await addReg(ev.id, a.id, "approved", 1, 0);
    asMember(a);
    await cancelMyRegistration({ code: ev.publicCode });
    const [after] = await testDb
      .select()
      .from(exchangeEvents)
      .where(eq(exchangeEvents.id, ev.id));
    expect(after.status).toBe("open");
  });

  it("cancel while locked sends the mandatory host notice and promotes nobody", async () => {
    await enableNotificationsForTest(testDb);
    const ev = await mkEvent({ status: "locked", slotsTotal: 2 });
    const a = await newMember();
    const w = await newMember();
    await addReg(ev.id, a.id, "approved", 1, 0);
    await addReg(ev.id, w.id, "waitlist", 1, 0, 1);
    asMember(a);
    expect(await cancelMyRegistration({ code: ev.publicCode })).toEqual({
      success: true,
    });
    expect((await regOf(ev.id, w.id))[0].status).toBe("waitlist");
    const kinds = (await testDb.select().from(notifications)).map(
      (n) => n.kind,
    );
    expect(kinds).toEqual(["exchange_cancelled_after_lock"]);
  });

  it("cancel on a done or cancelled event is refused", async () => {
    const done = await mkEvent({ status: "done" });
    const a = await newMember();
    await addReg(done.id, a.id, "approved", 1, 0);
    asMember(a);
    expect(await cancelMyRegistration({ code: done.publicCode })).toEqual({
      error: "eventClosed",
    });
    expect((await regOf(done.id, a.id))[0].status).toBe("approved");
  });

  it("only the caller's own registration can be cancelled", async () => {
    const ev = await mkEvent();
    const a = await newMember();
    const stranger = await newMember();
    await addReg(ev.id, a.id, "approved", 1, 0);
    asMember(stranger);
    expect(await cancelMyRegistration({ code: ev.publicCode })).toHaveProperty(
      "error",
    );
    expect((await regOf(ev.id, a.id))[0].status).toBe("approved");
  });
});

describe("money", () => {
  it("no path writes financial_transactions or session_debts", async () => {
    const f0 = (await testDb.select().from(financialTransactions)).length;
    const d0 = (await testDb.select().from(sessionDebts)).length;
    const ev = await mkEvent({ autoApprove: true, slotsTotal: 1 });
    const a = await newMember();
    const b = await newMember();
    asMember(a);
    await registerForExchange(input(ev.publicCode));
    asMember(b);
    await registerForExchange(input(ev.publicCode));
    asMember(a);
    await cancelMyRegistration({ code: ev.publicCode });
    expect((await testDb.select().from(financialTransactions)).length).toBe(f0);
    expect((await testDb.select().from(sessionDebts)).length).toBe(d0);
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  exchangeEvents,
  exchangeRegistrations,
  hostBlocks,
  notifications,
  venues,
  members,
} from "@/db/schema";
import { eq } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  flag: vi.fn(),
  auth: vi.fn(),
  updateTag: vi.fn(),
}));
vi.mock("@/lib/exchange-flag", () => ({ isExchangeEnabled: mocks.flag }));
vi.mock("@/lib/member-auth", () => ({
  requireApprovedMember: mocks.auth,
}));
vi.mock("next/cache", () => ({
  updateTag: mocks.updateTag,
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

const { db: testDb } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const {
  lockExchangeFees,
  setRegistrationPaid,
  setCheckedIn,
  markNoShow,
  finishExchangeEvent,
  cancelExchangeEvent,
} = await import("./exchange-host");
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
const [host2] = await testDb
  .insert(members)
  .values({ name: "Host2", approvalStatus: "approved" })
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

function as(m: Member | null) {
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
      publicCode: `hcode${codeSeq}`,
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
  male = 1,
  female = 0,
  extra: Partial<typeof exchangeRegistrations.$inferInsert> = {},
) {
  const [r] = await testDb
    .insert(exchangeRegistrations)
    .values({
      eventId,
      memberId,
      status,
      maleCount: male,
      femaleCount: female,
      createdAt: iso(0),
      updatedAt: iso(0),
      ...extra,
    })
    .returning();
  return r;
}

const reg = async (id: number) =>
  (
    await testDb
      .select()
      .from(exchangeRegistrations)
      .where(eq(exchangeRegistrations.id, id))
  )[0];
const evOf = async (id: number) =>
  (
    await testDb.select().from(exchangeEvents).where(eq(exchangeEvents.id, id))
  )[0];
const notes = (kind: string) =>
  testDb.select().from(notifications).where(eq(notifications.kind, kind));

beforeEach(async () => {
  await testDb.delete(notifications);
  await testDb.delete(exchangeRegistrations);
  await testDb.delete(hostBlocks);
  await testDb.delete(exchangeEvents);
  mocks.flag.mockReset().mockResolvedValue(true);
  mocks.auth.mockReset();
  mocks.updateTag.mockClear();
  await enableNotificationsForTest(testDb);
  as(host);
});

const HOUR = 3_600_000;

describe("check-in, no-show, finish, cancel", () => {
  it("check-in, no-show and cancel by a non-host are rejected, also with an extra actor field", async () => {
    const ev = await mkEvent({ startAt: iso(-HOUR), endAt: iso(HOUR) });
    const a = await addReg(ev.id, (await newMember()).id, "approved");
    const other = await newMember();
    for (const actor of [other, host2, null]) {
      as(actor);
      expect(
        await setCheckedIn({
          registrationId: a.id,
          checkedIn: true,
          actor: host.id,
        }),
      ).toHaveProperty("error");
      expect(
        await markNoShow({ registrationId: a.id, actor: host.id }),
      ).toHaveProperty("error");
      expect(
        await cancelExchangeEvent({ eventId: ev.id, actor: host.id }),
      ).toHaveProperty("error");
      expect(
        await finishExchangeEvent({ eventId: ev.id, actor: host.id }),
      ).toHaveProperty("error");
    }
    const r = await reg(a.id);
    expect([r.status, r.checkedIn]).toEqual(["approved", false]);
    expect((await evOf(ev.id)).status).toBe("open");
  });

  it("check-in works inside the window and flips no_show back to approved", async () => {
    const ev = await mkEvent({
      startAt: iso(30 * 60_000),
      endAt: iso(2 * HOUR),
    });
    const a = await addReg(ev.id, (await newMember()).id, "approved");
    expect(
      await setCheckedIn({ registrationId: a.id, checkedIn: true }),
    ).toMatchObject({ success: true });
    expect((await reg(a.id)).checkedIn).toBe(true);
    expect((await reg(a.id)).checkedInAt).not.toBeNull();
    await setCheckedIn({ registrationId: a.id, checkedIn: false });
    expect((await reg(a.id)).checkedIn).toBe(false);

    const ev2 = await mkEvent({ startAt: iso(-HOUR), endAt: iso(HOUR) });
    const n = await addReg(ev2.id, (await newMember()).id, "no_show");
    expect(
      await setCheckedIn({ registrationId: n.id, checkedIn: true }),
    ).toMatchObject({ success: true });
    const back = await reg(n.id);
    expect([back.status, back.checkedIn]).toEqual(["approved", true]);
  });

  it("check-in outside the window rejected", async () => {
    const early = await mkEvent({
      startAt: iso(2 * HOUR),
      endAt: iso(4 * HOUR),
    });
    const late = await mkEvent({
      startAt: iso(-9 * DAY),
      endAt: iso(-8 * DAY),
    });
    const cancelled = await mkEvent({
      startAt: iso(-HOUR),
      endAt: iso(HOUR),
      status: "cancelled",
    });
    for (const e of [early, late, cancelled]) {
      const r = await addReg(e.id, (await newMember()).id, "approved");
      expect(
        await setCheckedIn({ registrationId: r.id, checkedIn: true }),
      ).toHaveProperty("error");
      expect((await reg(r.id)).checkedIn).toBe(false);
    }
  });

  it("markNoShow only after start, for approved and not checked in", async () => {
    const future = await mkEvent();
    const f = await addReg(future.id, (await newMember()).id, "approved");
    expect(await markNoShow({ registrationId: f.id })).toHaveProperty("error");

    const ev = await mkEvent({ startAt: iso(-HOUR), endAt: iso(HOUR) });
    const absent = await addReg(ev.id, (await newMember()).id, "approved");
    const here = await addReg(ev.id, (await newMember()).id, "approved", 1, 0, {
      checkedIn: true,
    });
    expect(await markNoShow({ registrationId: absent.id })).toMatchObject({
      success: true,
    });
    expect((await reg(absent.id)).status).toBe("no_show");
    expect(await markNoShow({ registrationId: here.id })).toHaveProperty(
      "error",
    );
    expect((await reg(here.id)).status).toBe("approved");
  });

  it("finish requires locked and a started event", async () => {
    const open = await mkEvent({ startAt: iso(-HOUR), endAt: iso(HOUR) });
    expect(await finishExchangeEvent({ eventId: open.id })).toHaveProperty(
      "error",
    );
    const future = await mkEvent({ status: "locked", lockCount: 1 });
    expect(await finishExchangeEvent({ eventId: future.id })).toHaveProperty(
      "error",
    );
    const ok = await mkEvent({
      status: "locked",
      lockCount: 1,
      startAt: iso(-HOUR),
      endAt: iso(HOUR),
    });
    expect(await finishExchangeEvent({ eventId: ok.id })).toMatchObject({
      success: true,
    });
    const done = await evOf(ok.id);
    expect(done.status).toBe("done");
    expect(done.doneAt).not.toBeNull();
  });

  it("cancel notifies pending, approved and waitlisted once with their refundDue", async () => {
    const ev = await mkEvent({ depositAmount: 20000 });
    const p = await addReg(ev.id, (await newMember()).id, "pending");
    const a = await addReg(ev.id, (await newMember()).id, "approved", 1, 0, {
      depositPaid: true,
    });
    const w = await addReg(ev.id, (await newMember()).id, "waitlist");
    await addReg(ev.id, (await newMember()).id, "rejected");
    await addReg(ev.id, (await newMember()).id, "cancelled");

    expect(await cancelExchangeEvent({ eventId: ev.id })).toMatchObject({
      success: true,
    });
    const e = await evOf(ev.id);
    expect(e.status).toBe("cancelled");
    expect(e.cancelledAt).not.toBeNull();
    // Registration statuses are kept.
    expect((await reg(a.id)).status).toBe("approved");

    const sent = await notes("exchange_event_cancelled");
    expect(sent).toHaveLength(3);
    const due = (memberId: number) =>
      (
        sent.find((n) => n.recipientId === memberId)!.payload as {
          refundDue: number;
        }
      ).refundDue;
    expect(due(p.memberId)).toBe(0);
    expect(due(a.memberId)).toBe(20000);
    expect(due(w.memberId)).toBe(0);

    // A second cancel is refused and does not notify again.
    expect(await cancelExchangeEvent({ eventId: ev.id })).toHaveProperty(
      "error",
    );
    expect(await notes("exchange_event_cancelled")).toHaveLength(3);
  });

  it("cancelling a locked event refunds what a paid member already handed over", async () => {
    const ev = await mkEvent({ depositAmount: 20000 }); // fixed 50000
    const a = await addReg(ev.id, (await newMember()).id, "approved", 1, 0, {
      depositPaid: true,
    });
    await lockExchangeFees({
      eventId: ev.id,
      waivedRegistrationIds: [],
      confirmAboveEstimate: false,
    });
    await setRegistrationPaid({ registrationId: a.id, paid: true });
    await cancelExchangeEvent({ eventId: ev.id });
    const sent = await notes("exchange_event_cancelled");
    expect(sent).toHaveLength(1);
    // paidAmount = fee = 50000 was received in full, so 50000 is due back.
    expect((sent[0].payload as { refundDue: number }).refundDue).toBe(50000);
  });
});

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
  decideRegistration,
  setDepositReceived,
  increaseSlots,
  settleWaitlist,
  blockRegistrant,
  unblockMember,
  getManageView,
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

describe("host actions", () => {
  it("another member or a pending outsider cannot decide, take deposit, increase slots, block or read the manage view", async () => {
    const ev = await mkEvent({ depositAmount: 20000 });
    const m = await newMember();
    const r = await addReg(ev.id, m.id, "pending");
    const other = await newMember();
    for (const actor of [other, host2, null]) {
      as(actor);
      expect(
        await decideRegistration({ registrationId: r.id, decision: "reject" }),
      ).toHaveProperty("error");
      expect(
        await setDepositReceived({ registrationId: r.id, received: true }),
      ).toHaveProperty("error");
      expect(
        await increaseSlots({ eventId: ev.id, slotsTotal: 8 }),
      ).toHaveProperty("error");
      expect(await settleWaitlist({ eventId: ev.id })).toHaveProperty("error");
      expect(await blockRegistrant({ registrationId: r.id })).toHaveProperty(
        "error",
      );
      expect(await getManageView(ev.publicCode)).toBeNull();
    }
    // A pending outsider: the real auth guard returns an error.
    mocks.auth.mockResolvedValue({ error: "Tài khoản chờ admin duyệt." });
    expect(await getManageView(ev.publicCode)).toBeNull();
    expect(
      await decideRegistration({ registrationId: r.id, decision: "approve" }),
    ).toHaveProperty("error");
    expect((await reg(r.id)).status).toBe("pending");
    expect((await reg(r.id)).depositPaid).toBe(false);
    expect((await evOf(ev.id)).slotsTotal).toBe(4);
    expect(await testDb.select().from(hostBlocks)).toHaveLength(0);
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });

  it("returns an error and writes nothing when the flag is off", async () => {
    const ev = await mkEvent();
    const m = await newMember();
    const r = await addReg(ev.id, m.id, "pending");
    mocks.flag.mockResolvedValue(false);
    expect(
      await decideRegistration({ registrationId: r.id, decision: "approve" }),
    ).toHaveProperty("error");
    expect(await getManageView(ev.publicCode)).toBeNull();
    expect((await reg(r.id)).status).toBe("pending");
  });

  it("another host cannot unblock someone else's block", async () => {
    const m = await newMember();
    const [b] = await testDb
      .insert(hostBlocks)
      .values({
        hostMemberId: host.id,
        blockedMemberId: m.id,
        createdAt: iso(0),
      })
      .returning();
    as(host2);
    expect(await unblockMember({ blockId: b.id })).toHaveProperty("error");
    expect(await testDb.select().from(hostBlocks)).toHaveLength(1);
    as(host);
    expect(await unblockMember({ blockId: b.id })).toEqual({ success: true });
    expect(await testDb.select().from(hostBlocks)).toHaveLength(0);
  });

  it("approve requires the deposit when the event has one", async () => {
    const ev = await mkEvent({ depositAmount: 20000 });
    const m = await newMember();
    const r = await addReg(ev.id, m.id, "pending");
    expect(
      await decideRegistration({ registrationId: r.id, decision: "approve" }),
    ).toHaveProperty("error");
    expect((await reg(r.id)).status).toBe("pending");
    expect(await notes("exchange_registration_approved")).toHaveLength(0);

    await testDb
      .update(exchangeRegistrations)
      .set({ depositPaid: true })
      .where(eq(exchangeRegistrations.id, r.id));
    expect(
      await decideRegistration({ registrationId: r.id, decision: "approve" }),
    ).toEqual({ success: true });
    expect((await reg(r.id)).status).toBe("approved");
    expect(await notes("exchange_registration_approved")).toHaveLength(1);
    expect(mocks.updateTag).toHaveBeenCalledWith("exchange");

    // No deposit event: approve works directly, and only from pending.
    const free = await mkEvent();
    const m2 = await newMember();
    const r2 = await addReg(free.id, m2.id, "pending");
    expect(
      await decideRegistration({ registrationId: r2.id, decision: "approve" }),
    ).toEqual({ success: true });
    expect(
      await decideRegistration({ registrationId: r2.id, decision: "approve" }),
    ).toHaveProperty("error");
    expect(await notes("exchange_registration_approved")).toHaveLength(2);
  });

  it("rejecting an approved registration before lock promotes the waitlist", async () => {
    const ev = await mkEvent({ slotsTotal: 1, status: "full" });
    const a = await newMember();
    const b = await newMember();
    const ra = await addReg(ev.id, a.id, "approved");
    const rb = await addReg(ev.id, b.id, "waitlist", 1, 0, { waitlistPos: 1 });
    expect(
      await decideRegistration({ registrationId: ra.id, decision: "reject" }),
    ).toEqual({ success: true });
    expect((await reg(ra.id)).status).toBe("rejected");
    expect((await reg(rb.id)).status).toBe("pending");
    expect((await reg(rb.id)).waitlistPos).toBeNull();
    expect(await notes("exchange_registration_rejected")).toHaveLength(1);
    expect(await notes("exchange_waitlist_promoted")).toHaveLength(1);
    expect((await evOf(ev.id)).status).toBe("full");

    // After lock, an approved registration can no longer be rejected.
    const locked = await mkEvent({ status: "locked" });
    const c = await newMember();
    const rc = await addReg(locked.id, c.id, "approved");
    expect(
      await decideRegistration({ registrationId: rc.id, decision: "reject" }),
    ).toHaveProperty("error");
    expect((await reg(rc.id)).status).toBe("approved");
  });

  it("rejecting a pending registration with a paid deposit reports refundDue", async () => {
    const ev = await mkEvent({ depositAmount: 20000 });
    const m = await newMember();
    const r = await addReg(ev.id, m.id, "pending", 1, 0, {
      depositPaid: true,
      depositPaidAt: iso(0),
    });
    expect(
      await decideRegistration({ registrationId: r.id, decision: "reject" }),
    ).toEqual({ success: true });
    const [n] = await notes("exchange_registration_rejected");
    expect(n.payload).toMatchObject({ refundDue: 20000 });
    expect(n.recipientId).toBe(m.id);

    const m2 = await newMember();
    const r2 = await addReg(ev.id, m2.id, "pending");
    await decideRegistration({ registrationId: r2.id, decision: "reject" });
    const rows = await notes("exchange_registration_rejected");
    expect(rows.find((x) => x.recipientId === m2.id)!.payload).toMatchObject({
      refundDue: 0,
    });
  });

  it("any host action after reserveReleaseAt promotes the waiting male", async () => {
    // 2 slots, 1 reserved for women; the reserve opened an hour ago.
    const ev = await mkEvent({
      slotsTotal: 2,
      femaleReservedSlots: 1,
      reserveReleaseAt: iso(-3_600_000),
      status: "full",
    });
    const a = await newMember();
    const b = await newMember();
    await addReg(ev.id, a.id, "approved");
    const rb = await addReg(ev.id, b.id, "waitlist", 1, 0, { waitlistPos: 1 });
    // Blocking someone else's row is still a host action: settle runs first.
    const c = await newMember();
    const rc = await addReg(ev.id, c.id, "cancelled");
    expect(await blockRegistrant({ registrationId: rc.id })).toEqual({
      success: true,
    });
    expect((await reg(rb.id)).status).toBe("pending");

    const ev2 = await mkEvent({
      slotsTotal: 2,
      femaleReservedSlots: 1,
      reserveReleaseAt: iso(-3_600_000),
      status: "full",
    });
    const d = await newMember();
    const e = await newMember();
    await addReg(ev2.id, d.id, "approved");
    const re = await addReg(ev2.id, e.id, "waitlist", 1, 0, { waitlistPos: 1 });
    expect(await settleWaitlist({ eventId: ev2.id })).toEqual({
      success: true,
      data: { promoted: 1 },
    });
    expect((await reg(re.id)).status).toBe("pending");
  });

  it("increaseSlots cannot shrink, promotes when it grows", async () => {
    const ev = await mkEvent({ slotsTotal: 1, status: "full" });
    const a = await newMember();
    const b = await newMember();
    await addReg(ev.id, a.id, "approved");
    const rb = await addReg(ev.id, b.id, "waitlist", 1, 0, { waitlistPos: 1 });
    for (const n of [1, 0, 61]) {
      expect(
        await increaseSlots({ eventId: ev.id, slotsTotal: n }),
      ).toHaveProperty("error");
    }
    expect((await evOf(ev.id)).slotsTotal).toBe(1);
    expect(await increaseSlots({ eventId: ev.id, slotsTotal: 3 })).toEqual({
      success: true,
    });
    expect((await evOf(ev.id)).slotsTotal).toBe(3);
    expect((await evOf(ev.id)).status).toBe("open");
    expect((await reg(rb.id)).status).toBe("pending");

    const locked = await mkEvent({ status: "locked" });
    expect(
      await increaseSlots({ eventId: locked.id, slotsTotal: 9 }),
    ).toHaveProperty("error");
  });

  it("setDepositReceived twice approves and notifies once", async () => {
    const ev = await mkEvent({ depositAmount: 20000 });
    const m = await newMember();
    const r = await addReg(ev.id, m.id, "pending");
    expect(
      await setDepositReceived({ registrationId: r.id, received: true }),
    ).toEqual({ success: true });
    expect(
      await setDepositReceived({ registrationId: r.id, received: true }),
    ).toEqual({ success: true });
    const row = await reg(r.id);
    expect(row.status).toBe("approved");
    expect(row.depositPaid).toBe(true);
    expect(row.depositPaidAt).not.toBeNull();
    expect(await notes("exchange_registration_approved")).toHaveLength(1);

    const free = await mkEvent();
    const m2 = await newMember();
    const r2 = await addReg(free.id, m2.id, "pending");
    expect(
      await setDepositReceived({ registrationId: r2.id, received: true }),
    ).toHaveProperty("error");
  });

  it("manage view flags skill out of range, new accounts and locked accounts, with no phone or email", async () => {
    const ev = await mkEvent({
      skillMin: "tby",
      skillMax: "tb",
      depositAmount: 20000,
      status: "locked",
    });
    const low = await newMember({
      skillLevel: "yeu",
      phoneNumber: "0900000001",
    });
    const ok = await newMember({
      skillLevel: "tb",
      email: "a@b.c",
      approvalStatus: "pending",
    });
    const gone = await newMember({ isActive: false });
    const rej = await newMember({ approvalStatus: "rejected" });
    const r1 = await addReg(ev.id, low.id, "approved");
    await addReg(ev.id, ok.id, "pending");
    await addReg(ev.id, gone.id, "approved");
    await addReg(ev.id, rej.id, "pending");
    await testDb
      .update(exchangeRegistrations)
      .set({ depositPaid: true, feeAmount: 15000 })
      .where(eq(exchangeRegistrations.id, r1.id));
    await testDb.insert(hostBlocks).values({
      hostMemberId: host.id,
      blockedMemberId: rej.id,
      createdAt: iso(0),
    });

    const view = await getManageView(ev.publicCode);
    expect(view).not.toBeNull();
    const byName = (n: string) => view!.regs.find((r) => r.name === n)!;
    expect(byName(low.name)).toMatchObject({
      skillOutOfRange: true,
      isNewAccount: false,
      accountLocked: false,
      depositPaid: true,
      feeAmount: 15000,
      remaining: 0,
      refundDue: 5000,
    });
    expect(byName(ok.name)).toMatchObject({
      skillOutOfRange: false,
      isNewAccount: true,
    });
    expect(byName(gone.name).accountLocked).toBe(true);
    expect(byName(rej.name).accountLocked).toBe(true);
    expect(view!.blocks).toEqual([{ id: expect.any(Number), name: rej.name }]);
    expect(typeof view!.reserveOpened).toBe("boolean");
    const json = JSON.stringify(view);
    expect(json).not.toContain("0900000001");
    expect(json).not.toContain("a@b.c");
    expect(json).not.toMatch(/phone|email/i);
  });

  it("blockRegistrant is idempotent and leaves the registration alone", async () => {
    const ev = await mkEvent();
    const m = await newMember();
    const r = await addReg(ev.id, m.id, "approved");
    expect(await blockRegistrant({ registrationId: r.id })).toEqual({
      success: true,
    });
    expect(await blockRegistrant({ registrationId: r.id })).toEqual({
      success: true,
    });
    expect(await testDb.select().from(hostBlocks)).toHaveLength(1);
    expect((await reg(r.id)).status).toBe("approved");
  });
  it("reserveOpened is false without a reserve and true only after it is released", async () => {
    const none = await mkEvent();
    expect((await getManageView(none.publicCode))!.reserveOpened).toBe(false);
    const noneReleased = await mkEvent({ reserveReleaseAt: iso(-3_600_000) });
    expect((await getManageView(noneReleased.publicCode))!.reserveOpened).toBe(
      false,
    );
    const pending = await mkEvent({
      femaleReservedSlots: 1,
      reserveReleaseAt: iso(DAY),
    });
    expect((await getManageView(pending.publicCode))!.reserveOpened).toBe(
      false,
    );
    const open = await mkEvent({
      femaleReservedSlots: 1,
      reserveReleaseAt: iso(-3_600_000),
    });
    expect((await getManageView(open.publicCode))!.reserveOpened).toBe(true);
  });

  it("ignores an actor or hostMemberId field in the input", async () => {
    const ev = await mkEvent({ slotsTotal: 2 });
    const m = await newMember();
    const r = await addReg(ev.id, m.id, "pending");
    const other = await newMember();
    as(other);
    const spoof = { actor: host.id, hostMemberId: host.id, memberId: host.id };
    expect(
      await decideRegistration({
        registrationId: r.id,
        decision: "reject",
        ...spoof,
      }),
    ).toHaveProperty("error");
    expect(
      await increaseSlots({ eventId: ev.id, slotsTotal: 5, ...spoof }),
    ).toHaveProperty("error");
    expect((await reg(r.id)).status).toBe("pending");
    expect((await evOf(ev.id)).slotsTotal).toBe(2);
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });

  it("a host cannot act on a registration of another host's event", async () => {
    const mine = await mkEvent({ depositAmount: 20000 });
    const theirs = await mkEvent({
      hostMemberId: host2.id,
      depositAmount: 20000,
    });
    const m = await newMember();
    const r = await addReg(theirs.id, m.id, "pending");
    as(host);
    expect(
      await decideRegistration({ registrationId: r.id, decision: "reject" }),
    ).toHaveProperty("error");
    expect(
      await setDepositReceived({ registrationId: r.id, received: true }),
    ).toHaveProperty("error");
    expect(await blockRegistrant({ registrationId: r.id })).toHaveProperty(
      "error",
    );
    expect(
      await increaseSlots({ eventId: theirs.id, slotsTotal: 9 }),
    ).toHaveProperty("error");
    const row = await reg(r.id);
    expect(row.status).toBe("pending");
    expect(row.depositPaid).toBe(false);
    expect((await evOf(theirs.id)).slotsTotal).toBe(4);
    expect(await testDb.select().from(hostBlocks)).toHaveLength(0);
    expect(await testDb.select().from(notifications)).toHaveLength(0);
    expect(mocks.updateTag).not.toHaveBeenCalled();
    void mine;
  });
});

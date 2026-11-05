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
import { financialTransactions, sessionDebts } from "@/db/schema";

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
  unlockExchangeFees,
  setRegistrationPaid,
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

const SPLIT = {
  feeMode: "split_equal" as const,
  feeAmountMale: null,
  estimatedTotalCost: 300000,
  minHeads: 3,
  hostHeads: 1,
};

async function lock(eventId: number, waived: number[] = [], confirm = false) {
  return lockExchangeFees({
    eventId,
    waivedRegistrationIds: waived,
    confirmAboveEstimate: confirm,
  });
}

describe("lock fees", () => {
  it("lock recomputes server-side and stores integers per registration", async () => {
    const ev = await mkEvent(); // fixed 50000 per head
    const a = await addReg(ev.id, (await newMember()).id, "approved", 1);
    const b = await addReg(ev.id, (await newMember()).id, "approved", 2);
    const res = await lockExchangeFees({
      eventId: ev.id,
      waivedRegistrationIds: [],
      confirmAboveEstimate: false,
      // A client-sent amount must be ignored: the schema drops unknown keys.
      fees: [{ id: a.id, amount: 1 }],
    });
    expect(res).toMatchObject({ success: true });
    // Hand-worked: 1 head x 50000, 2 heads x 50000.
    expect((await reg(a.id)).feeAmount).toBe(50000);
    expect((await reg(b.id)).feeAmount).toBe(100000);
    const e = await evOf(ev.id);
    expect(e.status).toBe("locked");
    expect(e.lockCount).toBe(1);
    expect(e.lockedAt).not.toBeNull();
    expect(await notes("exchange_fee_locked")).toHaveLength(2);
    expect(mocks.updateTag).toHaveBeenCalledWith("exchange");
  });

  it("lock below minHeads → needsConfirm, nothing written; confirm locks", async () => {
    const ev = await mkEvent(SPLIT);
    const a = await addReg(ev.id, (await newMember()).id, "approved", 1);
    // 1 head + host = 2 heads: 300000 / 2 = 150000, above the estimate
    // 300000 / (3 + 1) = 75000.
    const first = await lock(ev.id);
    expect(first).toEqual({
      needsConfirm: {
        rates: { male: 150000, female: 150000 },
        estimate: { male: 75000, female: 75000 },
      },
    });
    expect((await reg(a.id)).feeAmount).toBeNull();
    expect((await evOf(ev.id)).status).toBe("open");
    expect((await evOf(ev.id)).lockCount).toBe(0);
    expect(await notes("exchange_fee_locked")).toHaveLength(0);

    expect(await lock(ev.id, [], true)).toMatchObject({ success: true });
    expect((await reg(a.id)).feeAmount).toBe(150000);
    expect((await evOf(ev.id)).status).toBe("locked");
  });

  it("lock refused while a registration is pending", async () => {
    const ev = await mkEvent();
    await addReg(ev.id, (await newMember()).id, "approved");
    const p = await addReg(ev.id, (await newMember()).id, "pending");
    expect(await lock(ev.id)).toHaveProperty("error");
    expect((await evOf(ev.id)).status).toBe("open");
    expect((await reg(p.id)).feeAmount).toBeNull();
  });

  it("rejects waived ids that are not chargeable registrations of this event", async () => {
    const ev = await mkEvent();
    const other = await mkEvent();
    await addReg(ev.id, (await newMember()).id, "approved");
    const w = await addReg(ev.id, (await newMember()).id, "waitlist");
    const foreign = await addReg(other.id, (await newMember()).id, "approved");
    expect(await lock(ev.id, [w.id])).toHaveProperty("error");
    expect(await lock(ev.id, [foreign.id])).toHaveProperty("error");
    expect((await evOf(ev.id)).status).toBe("open");
  });

  it("no_show and late_cancelled charged by default; waived get 0 and leave the divisor", async () => {
    const ev = await mkEvent(SPLIT);
    const a = await addReg(ev.id, (await newMember()).id, "approved");
    const n = await addReg(ev.id, (await newMember()).id, "no_show");
    const l = await addReg(ev.id, (await newMember()).id, "late_cancelled");
    const w = await addReg(ev.id, (await newMember()).id, "approved");
    const c = await addReg(ev.id, (await newMember()).id, "cancelled");
    expect(await lock(ev.id, [w.id])).toMatchObject({ success: true });
    // Charged heads: A, N, L = 3, plus host 1 = 4; 300000 / 4 = 75000.
    for (const r of [a, n, l]) expect((await reg(r.id)).feeAmount).toBe(75000);
    expect((await reg(w.id)).feeAmount).toBe(0);
    expect((await reg(w.id)).feeWaived).toBe(true);
    expect((await reg(c.id)).feeAmount).toBeNull();
  });

  async function lockedWithThree() {
    const ev = await mkEvent(SPLIT);
    const rs = [];
    for (let i = 0; i < 3; i++)
      rs.push(await addReg(ev.id, (await newMember()).id, "approved"));
    // 3 heads + host = 4: 300000 / 4 = 75000 each.
    expect(await lock(ev.id)).toMatchObject({ success: true });
    expect((await reg(rs[0].id)).feeAmount).toBe(75000);
    return { ev, rs };
  }

  async function leaveAndRelock(ev: { id: number }, leaver: { id: number }) {
    expect(await unlockExchangeFees({ eventId: ev.id })).toMatchObject({
      success: true,
    });
    await testDb
      .update(exchangeRegistrations)
      .set({ status: "cancelled" })
      .where(eq(exchangeRegistrations.id, leaver.id));
    await testDb.delete(notifications);
    expect(await lock(ev.id, [], true)).toMatchObject({ success: true });
  }

  it("relock: a paid participant who left gets fee null, a fee_changed notice, and refundDue from paidAmount", async () => {
    const { ev, rs } = await lockedWithThree();
    expect(
      await setRegistrationPaid({ registrationId: rs[0].id, paid: true }),
    ).toMatchObject({ success: true });
    await leaveAndRelock(ev, rs[0]);

    const gone = await reg(rs[0].id);
    expect(gone.feeAmount).toBeNull();
    expect(gone.paid).toBe(true);
    expect(gone.paidAmount).toBe(75000);
    // Two heads left + host = 3: 300000 / 3 = 100000.
    expect((await reg(rs[1].id)).feeAmount).toBe(100000);
    expect((await evOf(ev.id)).lockCount).toBe(2);

    const changed = await notes("exchange_fee_changed");
    expect(changed).toHaveLength(3);
    const goneNote = changed.find((n) => n.recipientId === gone.memberId);
    expect(goneNote).toBeDefined();
    expect(goneNote!.payload).toMatchObject({
      amount: 0,
      previousAmount: 75000,
    });

    const view = await getManageView(ev.publicCode);
    const row = view!.regs.find((r) => r.id === gone.id)!;
    expect(row.refundDue).toBe(75000);
    expect(row.remaining).toBe(0);
  });

  it("relock: paidAmount below the new fee shows the difference", async () => {
    const { ev, rs } = await lockedWithThree();
    await setRegistrationPaid({ registrationId: rs[1].id, paid: true });
    await leaveAndRelock(ev, rs[0]);
    const b = await reg(rs[1].id);
    expect(b.paid).toBe(true);
    expect(b.paidAmount).toBe(75000);
    expect(b.feeAmount).toBe(100000);
    const view = await getManageView(ev.publicCode);
    const row = view!.regs.find((r) => r.id === b.id)!;
    expect(row.remaining).toBe(25000);
    expect(row.refundDue).toBe(0);
  });

  it("relock notifies only changed amounts; paid stays true", async () => {
    const ev = await mkEvent(); // fixed 50000
    const a = await addReg(ev.id, (await newMember()).id, "approved", 1);
    const b = await addReg(ev.id, (await newMember()).id, "approved", 2);
    await lock(ev.id);
    await setRegistrationPaid({ registrationId: a.id, paid: true });
    await unlockExchangeFees({ eventId: ev.id });
    await testDb.delete(notifications);
    expect(await lock(ev.id, [b.id])).toMatchObject({ success: true });
    const changed = await notes("exchange_fee_changed");
    expect(changed).toHaveLength(1);
    expect(changed[0].recipientId).toBe(b.memberId);
    expect((await reg(b.id)).feeAmount).toBe(0);
    const ra = await reg(a.id);
    expect(ra.paid).toBe(true);
    expect(ra.paidAmount).toBe(50000);
    expect(await notes("exchange_fee_locked")).toHaveLength(0);
  });

  it("unlock after start does not promote the waitlist", async () => {
    const ev = await mkEvent({
      status: "locked",
      lockCount: 1,
      slotsTotal: 2,
      startAt: iso(-3_600_000),
      endAt: iso(3_600_000),
    });
    await addReg(ev.id, (await newMember()).id, "approved");
    const w = await addReg(ev.id, (await newMember()).id, "waitlist", 1, 0, {
      waitlistPos: 1,
    });
    expect(await unlockExchangeFees({ eventId: ev.id })).toMatchObject({
      success: true,
    });
    expect((await evOf(ev.id)).status).toBe("open");
    expect((await reg(w.id)).status).toBe("waitlist");
  });

  it("lock, pay, unlock, relock never write financial_transactions or session_debts", async () => {
    const ev = await mkEvent();
    const a = await addReg(ev.id, (await newMember()).id, "approved");
    await lock(ev.id);
    await setRegistrationPaid({ registrationId: a.id, paid: true });
    await unlockExchangeFees({ eventId: ev.id });
    await lock(ev.id);
    expect(await testDb.select().from(financialTransactions)).toHaveLength(0);
    expect(await testDb.select().from(sessionDebts)).toHaveLength(0);
  });

  it("paid, lock and unlock by a non-host are rejected, also with an extra actor field", async () => {
    const ev = await mkEvent();
    const a = await addReg(ev.id, (await newMember()).id, "approved");
    await lock(ev.id);
    const other = await newMember();
    for (const actor of [other, host2, null]) {
      as(actor);
      expect(
        await setRegistrationPaid({
          registrationId: a.id,
          paid: true,
          actor: host.id,
          hostId: host.id,
        }),
      ).toHaveProperty("error");
      expect(await unlockExchangeFees({ eventId: ev.id })).toHaveProperty(
        "error",
      );
      expect(await lock(ev.id)).toHaveProperty("error");
    }
    expect((await reg(a.id)).paid).toBe(false);
    expect((await evOf(ev.id)).status).toBe("locked");
  });

  it("setRegistrationPaid needs a locked event and a fee; false clears all three", async () => {
    const ev = await mkEvent();
    const a = await addReg(ev.id, (await newMember()).id, "approved");
    expect(
      await setRegistrationPaid({ registrationId: a.id, paid: true }),
    ).toHaveProperty("error");
    await lock(ev.id);
    expect(
      await setRegistrationPaid({ registrationId: a.id, paid: true }),
    ).toMatchObject({ success: true });
    const paid = await reg(a.id);
    expect([paid.paid, paid.paidAmount]).toEqual([true, 50000]);
    expect(paid.paidAt).not.toBeNull();
    await setRegistrationPaid({ registrationId: a.id, paid: false });
    const cleared = await reg(a.id);
    expect([cleared.paid, cleared.paidAmount, cleared.paidAt]).toEqual([
      false,
      null,
      null,
    ]);
  });
});

describe("paid-aware amounts", () => {
  // Fixed 50000 per head; the host re-prices by changing the head count.
  async function paidFull(opts: { deposit?: number; male?: number } = {}) {
    const ev = await mkEvent({ depositAmount: opts.deposit ?? 30000 });
    const a = await addReg(
      ev.id,
      (await newMember()).id,
      "approved",
      opts.male ?? 2,
      0,
      {
        depositPaid: true,
      },
    );
    expect(await lock(ev.id)).toMatchObject({ success: true });
    await setRegistrationPaid({ registrationId: a.id, paid: true });
    await unlockExchangeFees({ eventId: ev.id });
    await testDb.delete(notifications);
    return { ev, a };
  }
  const changedPayload = async () =>
    (await notes("exchange_fee_changed"))[0].payload as {
      remaining: number;
      refundDue: number;
    };
  const reprice = (eventId: number, amount: number) =>
    testDb
      .update(exchangeEvents)
      .set({ feeAmountMale: amount })
      .where(eq(exchangeEvents.id, eventId));

  it("relock down: fee 100K to 80K, paid 100K, deposit 30K gives remaining 0 and refundDue 20K", async () => {
    const { ev } = await paidFull(); // 2 heads x 50K = 100K
    await reprice(ev.id, 40000); // 2 x 40K = 80K
    await lock(ev.id);
    expect(await changedPayload()).toMatchObject({
      remaining: 0,
      refundDue: 20000,
    });
  });

  it("relock up: fee 100K to 120K, paid 100K gives remaining 20K and refundDue 0", async () => {
    const { ev, a } = await paidFull();
    await reprice(ev.id, 60000); // 2 x 60K = 120K
    await lock(ev.id);
    expect(await changedPayload()).toMatchObject({
      remaining: 20000,
      refundDue: 0,
    });
    // The member screen and payout agree with the notice.
    expect((await reg(a.id)).paidAmount).toBe(100000);
  });

  it("dropped paid member: refundDue is paidAmount (75K)", async () => {
    const { ev, rs } = await (async () => {
      const ev = await mkEvent(SPLIT);
      const rs = [];
      for (let i = 0; i < 3; i++)
        rs.push(await addReg(ev.id, (await newMember()).id, "approved"));
      await lock(ev.id);
      return { ev, rs };
    })();
    await setRegistrationPaid({ registrationId: rs[0].id, paid: true });
    await unlockExchangeFees({ eventId: ev.id });
    await testDb
      .update(exchangeRegistrations)
      .set({ status: "cancelled" })
      .where(eq(exchangeRegistrations.id, rs[0].id));
    await testDb.delete(notifications);
    await lock(ev.id, [], true);
    const gone = (await notes("exchange_fee_changed")).find(
      (n) => n.recipientId === rs[0].memberId,
    )!;
    expect(gone.payload).toMatchObject({
      amount: 0,
      remaining: 0,
      refundDue: 75000,
    });
  });

  it("tapping paid again after a relock down keeps paidAmount 100K and refundDue 20K", async () => {
    const { ev, a } = await paidFull();
    await reprice(ev.id, 40000);
    await lock(ev.id);
    expect(
      await setRegistrationPaid({ registrationId: a.id, paid: true }),
    ).toMatchObject({ success: true });
    expect((await reg(a.id)).paidAmount).toBe(100000);
    const row = (await getManageView(ev.publicCode))!.regs.find(
      (r) => r.id === a.id,
    )!;
    expect([row.remaining, row.refundDue]).toEqual([0, 20000]);
  });
});

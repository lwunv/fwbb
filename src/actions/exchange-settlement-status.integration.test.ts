/**
 * Tiền giao lưu đi qua cancel, từ chối và đăng ký lại (R22, R23). Màn thành
 * viên (`getExchangeEvent`, `getMyExchanges`) và màn host (`getManageView`)
 * phải cùng một số, vì cùng đi qua `registrationSettlement`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  exchangeEvents,
  exchangeRegistrations,
  hostBlocks,
  members,
  notifications,
  venues,
} from "@/db/schema";
import { eq } from "drizzle-orm";

type Member = typeof members.$inferSelect;

const mocks = vi.hoisted(() => ({
  flag: vi.fn(),
  current: { member: null as Member | null },
}));
vi.mock("@/lib/exchange-flag", () => ({ isExchangeEnabled: mocks.flag }));
vi.mock("@/lib/member-auth", () => {
  const auth = async () =>
    mocks.current.member
      ? {
          user: { memberId: mocks.current.member.id, externalId: "x" },
          member: mocks.current.member,
        }
      : { error: "no" };
  return {
    requireExchangeMember: auth,
    requireApprovedMember: auth,
    getExchangeViewer: async () =>
      mocks.current.member
        ? {
            status: "ok",
            user: { memberId: mocks.current.member.id, externalId: "x" },
            member: mocks.current.member,
            isGroupMember: true,
          }
        : { status: "anonymous" },
  };
});
vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("@/lib/exchange/guards", async (orig) => ({
  ...(await orig<typeof import("@/lib/exchange/guards")>()),
  checkBotAndRate: vi.fn(async () => ({ ok: true })),
}));

const { db: testDb } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { registerForExchange, cancelMyRegistration } =
  await import("./exchange-registrations");
const {
  decideRegistration,
  getManageView,
  lockExchangeFees,
  setRegistrationPaid,
  unlockExchangeFees,
} = await import("./exchange-host");
const { getExchangeEvent } = await import("./exchange-read");
const { getMyExchanges } = await import("./exchange-mine");
const { enableNotificationsForTest } =
  await import("@/lib/notifications/test-helpers");

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
async function newMember(): Promise<Member> {
  seq += 1;
  const [m] = await testDb
    .insert(members)
    .values({ name: `M${seq}`, approvalStatus: "approved" })
    .returning();
  return m;
}

const as = (m: Member | null) => {
  mocks.current.member = m;
};

let codeSeq = 0;
async function mkEvent(over: Partial<typeof exchangeEvents.$inferInsert> = {}) {
  codeSeq += 1;
  const [ev] = await testDb
    .insert(exchangeEvents)
    .values({
      publicCode: `stcode${codeSeq}`,
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
      payoutBankBin: "970416",
      payoutAccountNo: "123456789",
      payoutAccountName: "NGUYEN VAN A",
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
  extra: Partial<typeof exchangeRegistrations.$inferInsert> = {},
) {
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
      ...extra,
    })
    .returning();
  return r;
}

const regRow = async (id: number) =>
  (
    await testDb
      .select()
      .from(exchangeRegistrations)
      .where(eq(exchangeRegistrations.id, id))
  )[0];

async function memberView(m: Member, code: string) {
  as(m);
  const r = await getExchangeEvent(code);
  const mine = await getMyExchanges();
  if (!r || "error" in mine) throw new Error("no view");
  const card = mine.registrations.find((x) => x.code === code);
  return { my: r.viewer.myRegistration!, payout: r.viewer.payout, card };
}

async function hostRow(code: string, regId: number) {
  as(host);
  const v = await getManageView(code);
  return v!.regs.find((r) => r.id === regId)!;
}

beforeEach(async () => {
  await testDb.delete(notifications);
  await testDb.delete(exchangeRegistrations);
  await testDb.delete(hostBlocks);
  await testDb.delete(exchangeEvents);
  mocks.flag.mockReset().mockResolvedValue(true);
  await enableNotificationsForTest(testDb);
  as(null);
});

describe("settlement follows the registration status (R22)", () => {
  it("locked event, plain cancel before cancelDeadline: owes nothing, no payout, deposit comes back", async () => {
    // Fixed 50K, deposit 30K paid. Locked fee 50K, remaining was 20K.
    const ev = await mkEvent({ depositAmount: 30000 });
    const m = await newMember();
    const r = await addReg(ev.id, m.id, {
      depositPaid: true,
      depositPaidAt: iso(0),
    });
    as(host);
    expect(
      await lockExchangeFees({
        eventId: ev.id,
        waivedRegistrationIds: [],
        confirmAboveEstimate: true,
      }),
    ).toMatchObject({ success: true });
    expect((await memberView(m, ev.publicCode)).my.remaining).toBe(20000);

    as(m);
    expect(await cancelMyRegistration({ code: ev.publicCode })).toMatchObject({
      success: true,
    });
    expect((await regRow(r.id)).status).toBe("cancelled");

    const v = await memberView(m, ev.publicCode);
    expect([v.my.remaining, v.my.refundDue]).toEqual([0, 30000]);
    expect(v.payout).toBeNull();
    expect([v.card?.remaining, v.card?.refundDue]).toEqual([0, 30000]);

    const row = await hostRow(ev.publicCode, r.id);
    expect([row.remaining, row.refundDue, row.received]).toEqual([
      0, 30000, 30000,
    ]);
  });

  it("paid in full, rejected after reopen: owes nothing and gets the paid amount back", async () => {
    const ev = await mkEvent({ depositAmount: 30000 });
    const m = await newMember();
    const r = await addReg(ev.id, m.id, {
      depositPaid: true,
      depositPaidAt: iso(0),
    });
    as(host);
    await lockExchangeFees({
      eventId: ev.id,
      waivedRegistrationIds: [],
      confirmAboveEstimate: true,
    });
    expect(
      await setRegistrationPaid({ registrationId: r.id, paid: true }),
    ).toMatchObject({ success: true });
    expect(await unlockExchangeFees({ eventId: ev.id })).toMatchObject({
      success: true,
    });
    await testDb.delete(notifications);
    expect(
      await decideRegistration({ registrationId: r.id, decision: "reject" }),
    ).toMatchObject({ success: true });

    const stored = await regRow(r.id);
    expect(stored.status).toBe("rejected");
    // The old fee stays on the row as the relock baseline.
    expect([stored.feeAmount, stored.paidAmount]).toEqual([50000, 50000]);

    const v = await memberView(m, ev.publicCode);
    expect([v.my.remaining, v.my.refundDue]).toEqual([0, 50000]);
    expect(v.payout).toBeNull();
    const row = await hostRow(ev.publicCode, r.id);
    expect([row.remaining, row.refundDue, row.received]).toEqual([
      0, 50000, 50000,
    ]);
    const [note] = await testDb
      .select()
      .from(notifications)
      .where(eq(notifications.kind, "exchange_registration_rejected"));
    expect(note?.payload).toMatchObject({ refundDue: 50000 });
  });
});

describe("re-register keeps what was paid (R23)", () => {
  it("paid 50K, cancel, reopen, re-register: paidAmount kept and relock settles to 0", async () => {
    const ev = await mkEvent({ autoApprove: true });
    const m = await newMember();
    const r = await addReg(ev.id, m.id);
    as(host);
    await lockExchangeFees({
      eventId: ev.id,
      waivedRegistrationIds: [],
      confirmAboveEstimate: true,
    });
    await setRegistrationPaid({ registrationId: r.id, paid: true });
    as(m);
    expect(await cancelMyRegistration({ code: ev.publicCode })).toMatchObject({
      success: true,
    });
    as(host);
    await unlockExchangeFees({ eventId: ev.id });

    as(m);
    expect(
      await registerForExchange({
        code: ev.publicCode,
        maleCount: 1,
        femaleCount: 0,
        turnstileToken: "tok",
      }),
    ).toMatchObject({ success: true, data: { status: "approved" } });
    const back = await regRow(r.id);
    expect(back.status).toBe("approved");
    expect([back.paid, back.paidAmount]).toEqual([true, 50000]);
    expect(back.paidAt).toBeTruthy();

    // Before relock there is no fee: the 50K shows as held, to refund.
    const before = await hostRow(ev.publicCode, r.id);
    expect([before.remaining, before.refundDue, before.received]).toEqual([
      0, 50000, 50000,
    ]);

    as(host);
    expect(
      await lockExchangeFees({
        eventId: ev.id,
        waivedRegistrationIds: [],
        confirmAboveEstimate: true,
      }),
    ).toMatchObject({ success: true });
    const after = await hostRow(ev.publicCode, r.id);
    expect([after.remaining, after.refundDue, after.received]).toEqual([
      0, 0, 50000,
    ]);
    const v = await memberView(m, ev.publicCode);
    expect([v.my.remaining, v.my.refundDue]).toEqual([0, 0]);
    expect(v.payout).toBeNull();
  });
});

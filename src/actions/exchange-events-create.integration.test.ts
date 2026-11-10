import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { createHash } from "node:crypto";
import { venues, exchangeEvents, members, scheduledJobs } from "@/db/schema";
import { eq } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  flag: vi.fn(),
  auth: vi.fn(),
  bot: vi.fn(),
  updateTag: vi.fn(),
}));
vi.mock("@/lib/exchange-flag", () => ({ isExchangeEnabled: mocks.flag }));
vi.mock("@/lib/member-auth", () => ({ requireApprovedMember: mocks.auth }));
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
// Bắt việc hẹn sau phản hồi (nhắc chấm, Task 14 G2d) để test tự chạy.
const pendingAfter = vi.hoisted(() => [] as (() => Promise<unknown>)[]);
vi.mock("@/lib/notifications/after", () => ({
  runAfterResponse: (fn: () => Promise<unknown>) => {
    pendingAfter.push(fn);
  },
}));

const { db: testDb } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { createExchangeEvent, updateExchangeEvent, getMyLastPayout } =
  await import("./exchange-events");

const [approvedVenue] = await testDb
  .insert(venues)
  .values({ name: "A", lat: 10, lng: 106, status: "approved" })
  .returning();
const [pendingVenue] = await testDb
  .insert(venues)
  .values({ name: "P", lat: 10, lng: 106, status: "pending" })
  .returning();
const [host] = await testDb
  .insert(members)
  .values({ name: "Host", approvalStatus: "approved" })
  .returning();
const [other] = await testDb
  .insert(members)
  .values({ name: "Other", approvalStatus: "approved" })
  .returning();

function asMember(m: typeof host | null) {
  mocks.auth.mockResolvedValue(
    m
      ? { user: { memberId: m.id, externalId: "x" }, member: m }
      : { error: "no" },
  );
}

function form(over: Record<string, unknown> = {}) {
  // 40 days out keeps startAt inside the 30 min .. 60 day window.
  const d = new Date(Date.now() + 40 * 86_400_000);
  return {
    venueId: approvedVenue.id,
    date: d.toISOString().slice(0, 10),
    startTime: "20:30",
    endTime: "22:30",
    title: "Giao lưu tối thứ sáu",
    description: "",
    slotsTotal: 12,
    femaleReservedSlots: 0,
    reserveRelease: "never",
    hostHeads: 1,
    shuttleType: "",
    feeMode: "fixed",
    feeAmountMale: 50000,
    depositAmount: 0,
    hostContact: "0912345678",
    zaloGroupLink: "",
    turnstileToken: "tok",
    idempotencyKey: crypto.randomUUID(),
    ...over,
  };
}

async function memberCode(id: number) {
  const [row] = await testDb
    .select({ code: members.publicCode })
    .from(members)
    .where(eq(members.id, id));
  return row.code;
}

async function eventCount() {
  return (await testDb.select().from(exchangeEvents)).length;
}

beforeEach(async () => {
  await testDb.delete(exchangeEvents);
  mocks.flag.mockReset().mockResolvedValue(true);
  mocks.bot.mockReset().mockResolvedValue({ ok: true });
  mocks.auth.mockReset();
  mocks.updateTag.mockClear();
  asMember(host);
});

describe("createExchangeEvent", () => {
  it("create: an empty host contact is stored as null", async () => {
    const r = await createExchangeEvent(form({ hostContact: "" }));
    expect(r).toMatchObject({ success: true });
    const [row] = await testDb.select().from(exchangeEvents);
    expect(row.hostContact).toBeNull();
  });

  it("create: stores the event, nulls unused fee fields, busts the cache", async () => {
    const r = await createExchangeEvent(form());
    expect(r).toMatchObject({ success: true });
    const [row] = await testDb.select().from(exchangeEvents);
    expect(row.hostMemberId).toBe(host.id);
    expect(row.publicCode).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{10}$/);
    expect(row.feeAmountMale).toBe(50000);
    expect(row.feeAmountFemale).toBeNull();
    expect(row.estimatedTotalCost).toBeNull();
    expect(row.startAt.endsWith("Z")).toBe(true);
    expect(mocks.updateTag).toHaveBeenCalledWith("exchange");
    expect(mocks.bot).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "exchange_open",
        rateKey: `exchange-open:${host.id}`,
      }),
    );
  });

  it("create: pending exchange account rejected, nothing written", async () => {
    asMember(null);
    const r = await createExchangeEvent(form());
    expect(r).toHaveProperty("error");
    expect(mocks.bot).not.toHaveBeenCalled();
    expect(await eventCount()).toBe(0);
  });

  it("create: pending venue rejected", async () => {
    const r = await createExchangeEvent(form({ venueId: pendingVenue.id }));
    expect(r).toEqual({ error: "venueUnavailable" });
    expect(await eventCount()).toBe(0);
  });

  it("create: invalid input rejected before Turnstile", async () => {
    const r = await createExchangeEvent(form({ title: "ab" }));
    expect(r).toEqual({ error: "invalidInput" });
    expect(mocks.bot).not.toHaveBeenCalled();
  });

  it("create: deposit above the estimate rejected", async () => {
    const r = await createExchangeEvent(form({ depositAmount: 50001 }));
    expect(r).toEqual({ error: "depositTooHigh" });
    expect(await eventCount()).toBe(0);
    const fine = await createExchangeEvent(form({ depositAmount: 50000 }));
    expect(fine).toMatchObject({ success: true });
  });

  it("create: deposit is capped by the lower of male and female estimates", async () => {
    const r = await createExchangeEvent(
      form({
        feeMode: "fixed_gender",
        feeAmountMale: 60000,
        feeAmountFemale: 30000,
        depositAmount: 40000,
      }),
    );
    expect(r).toEqual({ error: "depositTooHigh" });
  });

  it("create: same idempotencyKey twice → one row, same code", async () => {
    const f = form();
    const a = await createExchangeEvent(f);
    const b = await createExchangeEvent(f);
    expect(a).toMatchObject({ success: true });
    expect(b).toEqual(a);
    expect(await eventCount()).toBe(1);
  });

  it("create: flag off errors before any DB read", async () => {
    mocks.flag.mockResolvedValue(false);
    const r = await createExchangeEvent(form());
    expect(r).toEqual({ error: "notFound" });
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.bot).not.toHaveBeenCalled();
    expect(await eventCount()).toBe(0);
  });

  it("create: a start under 30 minutes away is rejected", async () => {
    const r = await createExchangeEvent(
      form({
        date: new Date().toISOString().slice(0, 10),
        startTime: "00:00",
        endTime: "00:01",
      }),
    );
    expect(r).toHaveProperty("error");
    expect(await eventCount()).toBe(0);
  });

  it("creating an event gives the host a code", async () => {
    const [fresh] = await testDb
      .insert(members)
      .values({ name: "Fresh host", approvalStatus: "approved" })
      .returning();
    expect(fresh.publicCode).toBeNull();
    asMember(fresh);
    expect(await createExchangeEvent(form())).toMatchObject({ success: true });
    const code = await memberCode(fresh.id);
    expect(code).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{10}$/);
    // A second event keeps the same profile code.
    expect(await createExchangeEvent(form())).toMatchObject({ success: true });
    expect(await memberCode(fresh.id)).toBe(code);
  });

  it("create: a failed Turnstile assigns no code", async () => {
    const [fresh] = await testDb
      .insert(members)
      .values({ name: "Bot host", approvalStatus: "approved" })
      .returning();
    asMember(fresh);
    mocks.bot.mockResolvedValue({ error: "captcha" });
    expect(await createExchangeEvent(form())).toEqual({
      error: "captcha",
    });
    expect(await memberCode(fresh.id)).toBeNull();
  });

  it("a code failure on create returns saveFailed instead of throwing", async () => {
    const [fresh] = await testDb
      .insert(members)
      .values({ name: "Unlucky host", approvalStatus: "approved" })
      .returning();
    asMember(fresh);
    // The profile code write is the first UPDATE on this path.
    const spy = vi.spyOn(testDb, "update").mockImplementationOnce(() => {
      throw new Error("socket hang up");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await createExchangeEvent(form())).toEqual({
        error: "saveFailed",
      });
      expect(log).toHaveBeenCalledWith("[Reputation] code_failed", {
        memberId: fresh.id,
      });
      expect(await eventCount()).toBe(0);
      expect(mocks.updateTag).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      log.mockRestore();
    }
  });

  it("create: a client-sent host id is ignored", async () => {
    await createExchangeEvent({ ...form(), hostMemberId: other.id });
    const [row] = await testDb.select().from(exchangeEvents);
    expect(row.hostMemberId).toBe(host.id);
  });
});

describe("updateExchangeEvent", () => {
  async function open() {
    const r = await createExchangeEvent(form());
    if (!("success" in r)) throw new Error("setup");
    const [row] = await testDb.select().from(exchangeEvents);
    return row;
  }

  it("update: host edits title and contact", async () => {
    const ev = await open();
    const r = await updateExchangeEvent({
      eventId: ev.id,
      title: "Tên mới cho buổi",
      hostContact: "https://zalo.me/0900000000",
    });
    expect(r).toEqual({ success: true });
    const [row] = await testDb
      .select()
      .from(exchangeEvents)
      .where(eq(exchangeEvents.id, ev.id));
    expect(row.title).toBe("Tên mới cho buổi");
    expect(row.hostContact).toBe("https://zalo.me/0900000000");
  });

  it("update: a database failure returns the translated saveFailed and logs only the event id", async () => {
    const ev = await open();
    const spy = vi
      .spyOn(testDb, "transaction")
      .mockRejectedValueOnce(new Error("socket hang up"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(
        await updateExchangeEvent({ eventId: ev.id, title: "Tên mới hẳn" }),
      ).toEqual({ error: "saveFailed" });
      expect(log).toHaveBeenCalledWith("[Exchange] update_failed", {
        eventId: ev.id,
      });
    } finally {
      spy.mockRestore();
      log.mockRestore();
    }
  });

  it("update: payout null clears the account", async () => {
    const ev = await open();
    expect(await updateExchangeEvent({ eventId: ev.id, payout: null })).toEqual(
      { success: true },
    );
    const [row] = await testDb
      .select()
      .from(exchangeEvents)
      .where(eq(exchangeEvents.id, ev.id));
    expect(row.payoutBankBin).toBeNull();
    expect(row.payoutAccountNo).toBeNull();
    expect(row.payoutAccountName).toBeNull();
  });

  it("update: an empty contact clears it to null", async () => {
    const ev = await open();
    const r = await updateExchangeEvent({ eventId: ev.id, hostContact: "" });
    expect(r).toEqual({ success: true });
    const [row] = await testDb
      .select()
      .from(exchangeEvents)
      .where(eq(exchangeEvents.id, ev.id));
    expect(row.hostContact).toBeNull();
  });

  it("update: another member cannot edit; extra fields like startAt are ignored", async () => {
    const ev = await open();
    asMember(other);
    const denied = await updateExchangeEvent({
      eventId: ev.id,
      title: "Tên khác hẳn",
    });
    expect(denied).toHaveProperty("error");

    asMember(host);
    const r = await updateExchangeEvent({
      eventId: ev.id,
      title: "Tên mới cho buổi",
      startAt: "2030-01-01T00:00:00.000Z",
      feeAmountMale: 1,
      slotsTotal: 99,
    } as never);
    expect(r).toEqual({ success: true });
    const [row] = await testDb
      .select()
      .from(exchangeEvents)
      .where(eq(exchangeEvents.id, ev.id));
    expect(row.startAt).toBe(ev.startAt);
    expect(row.feeAmountMale).toBe(50000);
    expect(row.slotsTotal).toBe(12);
    expect(row.title).toBe("Tên mới cho buổi");
  });

  it("update: rejected once the event is locked", async () => {
    const ev = await open();
    await testDb
      .update(exchangeEvents)
      .set({ status: "locked" })
      .where(eq(exchangeEvents.id, ev.id));
    const r = await updateExchangeEvent({
      eventId: ev.id,
      title: "Tên mới cho buổi",
    });
    expect(r).toEqual({ error: "eventClosed" });
  });

  it("update: payout is all three or none", async () => {
    const ev = await open();
    const bad = await updateExchangeEvent({
      eventId: ev.id,
      payout: { bankBin: "970436", accountNo: "12", accountName: "A" },
    });
    expect(bad).toEqual({ error: "invalidInput" });
    const good = await updateExchangeEvent({
      eventId: ev.id,
      payout: {
        bankBin: "970436",
        accountNo: "0123456789",
        accountName: "NGUYEN VAN A",
      },
    });
    expect(good).toEqual({ success: true });
    expect(await getMyLastPayout()).toEqual({
      bankBin: "970436",
      accountNo: "0123456789",
      accountName: "NGUYEN VAN A",
    });
  });

  it("update: flag off errors first", async () => {
    mocks.flag.mockResolvedValue(false);
    expect(
      await updateExchangeEvent({ eventId: 1, title: "Tên mới cho buổi" }),
    ).toEqual({ error: "notFound" });
    expect(mocks.auth).not.toHaveBeenCalled();
  });
});

async function flushAfter() {
  while (pendingAfter.length > 0) await pendingAfter.shift()!();
}
const ratingKey = (id: number, endAt: string) =>
  `xrate:${id}:${createHash("sha256").update(endAt).digest("hex").slice(0, 8)}`;
const ratingRows = () =>
  testDb
    .select()
    .from(scheduledJobs)
    .where(eq(scheduledJobs.kind, "exchange_rate_reminder"));

describe("createExchangeEvent rating reminder", () => {
  it("creating an event schedules one reminder at endAt plus 1 hour with the fingerprint", async () => {
    const { enableNotificationsForTest } =
      await import("@/lib/notifications/test-helpers");
    await enableNotificationsForTest(testDb);
    await testDb.delete(scheduledJobs);
    pendingAfter.length = 0;
    try {
      const f = form();
      expect(await createExchangeEvent(f)).toMatchObject({ success: true });
      // Gửi lại cùng khoá: vẫn chỉ một job.
      expect(await createExchangeEvent(f)).toMatchObject({ success: true });
      await flushAfter();
      const [ev] = await testDb.select().from(exchangeEvents);
      const rows = await ratingRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        jobKey: ratingKey(ev.id, ev.endAt),
        runAt: new Date(Date.parse(ev.endAt) + 3_600_000).toISOString(),
        status: "scheduled",
        messageId: null,
      });
    } finally {
      await testDb.delete(scheduledJobs);
      const { appSettings } = await import("@/db/schema");
      await testDb.delete(appSettings);
    }
  });
});

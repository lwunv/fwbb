import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import { admins, notifications } from "@/db/schema";

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const ex = await import("./exchange-events");
const { enableNotificationsForTest } = await import("./test-helpers");

const NOW = new Date("2026-11-10T03:00:00.000Z");
const event = {
  id: 5,
  publicCode: "ab12cd",
  title: "Giao lưu Thứ 7",
  startAt: "2026-11-14T12:00:00.000Z",
  hostMemberId: 100,
  depositAmount: 50000,
  lockCount: 1,
};

async function rows(kind?: string) {
  const q = testDb.select().from(notifications);
  return kind ? q.where(eq(notifications.kind, kind)) : q;
}

beforeEach(async () => {
  for (const t of [
    "notifications",
    "notification_prefs",
    "admins",
    "app_settings",
  ]) {
    await client.execute(`DELETE FROM ${t}`).catch(() => undefined);
  }
  await enableNotificationsForTest(testDb);
});

describe("exchange-events", () => {
  it("notifyRegistrationReceived payload has heads and no name", async () => {
    await testDb.transaction((tx) =>
      ex.notifyRegistrationReceived(
        tx,
        {
          event,
          reg: { id: 9, maleCount: 2, femaleCount: 1 },
          needsApproval: true,
          now: NOW,
        },
        true,
      ),
    );
    const [row] = await rows("exchange_registration_received");
    expect(row.recipientType).toBe("member");
    expect(row.recipientId).toBe(100);
    expect(row.entityType).toBe("exchange_event");
    expect(row.entityId).toBe(5);
    expect(row.dedupKey).toBe(`xreg:r9:new:${NOW.toISOString()}:m100`);
    expect(row.payload).toEqual({
      eventCode: "ab12cd",
      eventTitle: "Giao lưu Thứ 7",
      heads: 3,
      needsApproval: true,
    });
  });

  it("notifyRegistrationDecision sends approved, rejected and promoted to the member", async () => {
    await testDb.transaction(async (tx) => {
      await ex.notifyRegistrationDecision(
        tx,
        { event, reg: { id: 9, memberId: 7 }, decision: "approved", now: NOW },
        true,
      );
      await ex.notifyRegistrationDecision(
        tx,
        {
          event,
          reg: { id: 10, memberId: 8 },
          decision: "rejected",
          refundDue: 50000,
          now: NOW,
        },
        true,
      );
      await ex.notifyRegistrationDecision(
        tx,
        {
          event,
          reg: { id: 11, memberId: 12 },
          decision: "promoted",
          status: "pending",
          now: NOW,
        },
        true,
      );
    });
    const [a] = await rows("exchange_registration_approved");
    expect(a.recipientId).toBe(7);
    expect(a.payload).toEqual({
      eventCode: "ab12cd",
      eventTitle: event.title,
      startAt: event.startAt,
    });
    const [r] = await rows("exchange_registration_rejected");
    expect(r.payload).toMatchObject({ refundDue: 50000 });
    const [p] = await rows("exchange_waitlist_promoted");
    expect(p.payload).toMatchObject({ status: "pending" });
    expect(p.dedupKey).toBe(`xreg:r11:promoted:${NOW.toISOString()}:m12`);
  });

  it("notifyRegistrationCancelled picks the kind by afterLock and tells the host only a head count", async () => {
    const reg = { id: 9, maleCount: 1, femaleCount: 1 };
    await testDb.transaction(async (tx) => {
      await ex.notifyRegistrationCancelled(
        tx,
        { event, reg, late: false, afterLock: false, now: NOW },
        true,
      );
      await ex.notifyRegistrationCancelled(
        tx,
        {
          event,
          reg: { ...reg, id: 10 },
          late: true,
          afterLock: true,
          now: NOW,
        },
        true,
      );
    });
    const [a] = await rows("exchange_registration_cancelled");
    expect(a.payload).toEqual({
      eventCode: "ab12cd",
      eventTitle: event.title,
      heads: 2,
      late: false,
    });
    expect(a.dedupKey).toBe(`xcancel:r9:${NOW.toISOString()}:m100`);
    const [b] = await rows("exchange_cancelled_after_lock");
    expect(b.payload).toMatchObject({ heads: 2, late: true });
  });

  it("notifyFeesLocked first lock tells everyone charged, relock only those whose amount changed", async () => {
    const changes = [
      {
        reg: { id: 1, memberId: 21, depositPaid: true },
        amount: 80000,
        previousAmount: null,
      },
      {
        reg: { id: 2, memberId: 22, depositPaid: false },
        amount: 30000,
        previousAmount: null,
      },
    ];
    await testDb.transaction((tx) =>
      ex.notifyFeesLocked(
        tx,
        { event: { ...event, lockCount: 1 }, changes, now: NOW },
        true,
      ),
    );
    const locked = await rows("exchange_fee_locked");
    expect(locked).toHaveLength(2);
    expect(locked.find((r) => r.recipientId === 21)!.payload).toMatchObject({
      amount: 80000,
      deposit: 50000,
      remaining: 30000,
      refundDue: 0,
      aboveEstimate: false,
    });
    expect(locked.find((r) => r.recipientId === 22)!.payload).toMatchObject({
      amount: 30000,
      deposit: 0,
      remaining: 30000,
      refundDue: 0,
    });
    expect(locked[0].dedupKey).toBe(`xfee:e5:n1:m${locked[0].recipientId}`);

    await testDb.transaction((tx) =>
      ex.notifyFeesLocked(
        tx,
        {
          event: { ...event, lockCount: 2 },
          changes: [
            {
              reg: { id: 1, memberId: 21, depositPaid: true },
              amount: 80000,
              previousAmount: 80000,
            },
            {
              reg: { id: 2, memberId: 22, depositPaid: false },
              amount: 0,
              previousAmount: 30000,
            },
          ],
          now: NOW,
        },
        true,
      ),
    );
    const changed = await rows("exchange_fee_changed");
    expect(changed).toHaveLength(1);
    expect(changed[0].recipientId).toBe(22);
    expect(changed[0].payload).toMatchObject({
      amount: 0,
      previousAmount: 30000,
    });
  });

  it("notifyFeesLocked twice with the same lockCount inserts nothing new", async () => {
    const input = {
      event: { ...event, lockCount: 1 },
      changes: [
        {
          reg: { id: 1, memberId: 21, depositPaid: false },
          amount: 40000,
          previousAmount: null,
        },
      ],
      now: NOW,
    };
    await testDb.transaction((tx) => ex.notifyFeesLocked(tx, input, true));
    await testDb.transaction((tx) => ex.notifyFeesLocked(tx, input, true));
    expect(await rows("exchange_fee_locked")).toHaveLength(1);
  });

  it("notifyEventCancelled reaches pending, approved and waitlist with their own refundDue", async () => {
    await testDb.transaction((tx) =>
      ex.notifyEventCancelled(
        tx,
        {
          event,
          regs: [
            { id: 1, memberId: 31, status: "approved", refundDue: 50000 },
            { id: 2, memberId: 32, status: "pending", refundDue: 0 },
            { id: 3, memberId: 33, status: "waitlist", refundDue: 0 },
            { id: 4, memberId: 34, status: "cancelled", refundDue: 0 },
          ],
          now: NOW,
        },
        true,
      ),
    );
    const out = await rows("exchange_event_cancelled");
    expect(out.map((r) => r.recipientId).sort()).toEqual([31, 32, 33]);
    expect(out.find((r) => r.recipientId === 31)!.payload).toMatchObject({
      refundDue: 50000,
    });
    expect(out[0].dedupKey).toMatch(/^xevcancel:e5:m3\d$/);
  });

  it("notifyEventHidden tells the host and notifyReported tells superadmins", async () => {
    const [sa] = await testDb
      .insert(admins)
      .values({ username: "sa1", passwordHash: "x", role: "superadmin" })
      .returning({ id: admins.id });
    await testDb.transaction(async (tx) => {
      await ex.notifyEventHidden(tx, { event, now: NOW }, true);
      await ex.notifyReported(
        tx,
        { reportId: 3, targetType: "event", reason: "spam" },
        true,
      );
    });
    const [h] = await rows("exchange_event_hidden");
    expect(h.recipientId).toBe(100);
    expect(h.dedupKey).toBe(`xhide:e5:${NOW.toISOString()}:m100`);
    const [r] = await rows("exchange_reported");
    expect(r.recipientType).toBe("admin");
    expect(r.recipientId).toBe(sa.id);
    expect(r.payload).toEqual({ targetType: "event", reason: "spam" });
    expect(r.dedupKey).toBe(`xreport:3:a${sa.id}`);
  });

  it("gate false writes nothing", async () => {
    await testDb
      .insert(admins)
      .values({ username: "sa2", passwordHash: "x", role: "superadmin" });
    const oneHead = { id: 9, maleCount: 1, femaleCount: 0 };
    await testDb.transaction(async (tx) => {
      await ex.notifyRegistrationReceived(
        tx,
        { event, reg: oneHead, needsApproval: false, now: NOW },
        false,
      );
      await ex.notifyRegistrationDecision(
        tx,
        { event, reg: { id: 9, memberId: 7 }, decision: "approved", now: NOW },
        false,
      );
      await ex.notifyRegistrationCancelled(
        tx,
        { event, reg: oneHead, late: false, afterLock: false, now: NOW },
        false,
      );
      await ex.notifyFeesLocked(
        tx,
        {
          event,
          changes: [
            {
              reg: { id: 1, memberId: 21, depositPaid: false },
              amount: 1000,
              previousAmount: null,
            },
          ],
          now: NOW,
        },
        false,
      );
      await ex.notifyEventCancelled(
        tx,
        {
          event,
          regs: [{ id: 1, memberId: 31, status: "approved", refundDue: 0 }],
          now: NOW,
        },
        false,
      );
      await ex.notifyEventHidden(tx, { event, now: NOW }, false);
      await ex.notifyReported(
        tx,
        { reportId: 1, targetType: "member", reason: "abusive" },
        false,
      );
    });
    expect(await rows()).toHaveLength(0);
  });
});

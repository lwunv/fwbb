import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  abuseReports,
  exchangeEvents,
  exchangeRegistrations,
  members,
  notifications,
  venues,
} from "@/db/schema";
import { eq } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  flag: vi.fn(),
  admin: vi.fn(),
  updateTag: vi.fn(),
}));
vi.mock("@/lib/exchange-flag", () => ({ isExchangeEnabled: mocks.flag }));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.admin }));
vi.mock("next/cache", () => ({
  updateTag: mocks.updateTag,
  revalidatePath: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

const { db: testDb } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const {
  adminListExchanges,
  adminSetExchangeHidden,
  adminCancelExchange,
  adminListReports,
  adminResolveReport,
} = await import("./exchange-admin");
const { enableNotificationsForTest } =
  await import("@/lib/notifications/test-helpers");

const DAY = 86_400_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const [venue] = await testDb
  .insert(venues)
  .values({ name: "San Z", lat: 10, lng: 106, status: "approved" })
  .returning();
const [host] = await testDb
  .insert(members)
  .values({
    name: "Host A",
    approvalStatus: "approved",
    phoneNumber: "0900000001",
    email: "host@example.com",
  })
  .returning();
const [guest] = await testDb
  .insert(members)
  .values({ name: "Guest B", approvalStatus: "approved" })
  .returning();

let seq = 0;
async function mkEvent(over: Partial<typeof exchangeEvents.$inferInsert> = {}) {
  seq += 1;
  const [ev] = await testDb
    .insert(exchangeEvents)
    .values({
      publicCode: `adm${seq}`,
      hostMemberId: host.id,
      venueId: venue.id,
      title: `Buoi ${seq}`,
      startAt: iso(5 * DAY),
      endAt: iso(5 * DAY + 2 * 3_600_000),
      slotsTotal: 4,
      feeMode: "fixed",
      feeAmountMale: 50000,
      registerDeadline: iso(4 * DAY),
      cancelDeadline: iso(3 * DAY),
      status: "open",
      createdAt: iso(0),
      updatedAt: iso(0),
      ...over,
    })
    .returning();
  return ev;
}
async function addReg(eventId: number) {
  await testDb.insert(exchangeRegistrations).values({
    eventId,
    memberId: guest.id,
    status: "approved",
    maleCount: 1,
    femaleCount: 0,
    createdAt: iso(0),
    updatedAt: iso(0),
  });
}
const noticesOf = (kind: string) =>
  testDb.select().from(notifications).where(eq(notifications.kind, kind));

beforeEach(async () => {
  await testDb.delete(notifications);
  await testDb.delete(abuseReports);
  await testDb.delete(exchangeRegistrations);
  await testDb.delete(exchangeEvents);
  await enableNotificationsForTest(testDb);
  mocks.flag.mockReset().mockResolvedValue(true);
  mocks.admin.mockReset().mockResolvedValue({ admin: { sub: "1" } });
  mocks.updateTag.mockClear();
});

describe("exchange admin actions", () => {
  it("admin actions refuse a member cookie", async () => {
    const ev = await mkEvent();
    mocks.admin.mockResolvedValue({ error: "Không có quyền admin" });
    expect(await adminListExchanges("all")).toEqual({
      error: "Không có quyền admin",
    });
    expect(
      await adminSetExchangeHidden({ eventId: ev.id, hidden: true }),
    ).toHaveProperty("error");
    expect(await adminCancelExchange({ eventId: ev.id })).toHaveProperty(
      "error",
    );
    expect(await adminListReports("open")).toHaveProperty("error");
    expect(
      await adminResolveReport({ reportId: 1, status: "resolved" }),
    ).toHaveProperty("error");
    const [row] = await testDb
      .select()
      .from(exchangeEvents)
      .where(eq(exchangeEvents.id, ev.id));
    expect(row.hiddenAt).toBeNull();
    expect(row.status).toBe("open");
  });

  it("refuses everything when the flag is off", async () => {
    const ev = await mkEvent();
    mocks.flag.mockResolvedValue(false);
    expect(await adminListExchanges("all")).toEqual({ error: "notFound" });
    expect(
      await adminSetExchangeHidden({ eventId: ev.id, hidden: true }),
    ).toEqual({ error: "notFound" });
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("lists events without host contact data", async () => {
    const ev = await mkEvent();
    await addReg(ev.id);
    await mkEvent({ hiddenAt: iso(-1000) });
    const all = await adminListExchanges("all");
    if ("error" in all) throw new Error(all.error);
    expect(all.data).toHaveLength(2);
    const row = all.data.find((r) => r.id === ev.id)!;
    expect(row).toMatchObject({
      hostName: "Host A",
      venueName: "San Z",
      publicCode: ev.publicCode,
      holdingHeads: 1,
    });
    expect(JSON.stringify(all.data)).not.toContain("0900000001");
    expect(JSON.stringify(all.data)).not.toContain("host@example.com");
    const hidden = await adminListExchanges("hidden");
    if ("error" in hidden) throw new Error(hidden.error);
    expect(hidden.data).toHaveLength(1);
    const upcoming = await adminListExchanges("upcoming");
    if ("error" in upcoming) throw new Error(upcoming.error);
    expect(upcoming.data.map((r) => r.id)).toEqual([ev.id]);
  });

  it("hiding notifies the host; cancelling notifies registrants", async () => {
    const ev = await mkEvent();
    await addReg(ev.id);
    expect(
      await adminSetExchangeHidden({ eventId: ev.id, hidden: true }),
    ).toEqual({ success: true });
    const hid = await noticesOf("exchange_event_hidden");
    expect(hid).toHaveLength(1);
    expect(hid[0].recipientId).toBe(host.id);
    expect(mocks.updateTag).toHaveBeenCalledWith("exchange");

    // Ẩn lần hai khi đã ẩn: không gửi tin thứ hai.
    await adminSetExchangeHidden({ eventId: ev.id, hidden: true });
    expect(await noticesOf("exchange_event_hidden")).toHaveLength(1);

    expect(
      await adminSetExchangeHidden({ eventId: ev.id, hidden: false }),
    ).toEqual({ success: true });
    const [shown] = await testDb
      .select()
      .from(exchangeEvents)
      .where(eq(exchangeEvents.id, ev.id));
    expect(shown.hiddenAt).toBeNull();

    expect(await adminCancelExchange({ eventId: ev.id })).toEqual({
      success: true,
    });
    const canc = await noticesOf("exchange_event_cancelled");
    expect(canc.map((n) => n.recipientId)).toEqual([guest.id]);
    // Gọi lặp: buổi đã huỷ, trả lỗi và không gửi thêm.
    expect(await adminCancelExchange({ eventId: ev.id })).toHaveProperty(
      "error",
    );
    expect(await noticesOf("exchange_event_cancelled")).toHaveLength(1);
  });

  it("rejects bad input and unknown events", async () => {
    expect(
      await adminSetExchangeHidden({ eventId: "x", hidden: true }),
    ).toEqual({ error: "invalidInput" });
    expect(
      await adminSetExchangeHidden({ eventId: 99999, hidden: true }),
    ).toEqual({ error: "notFound" });
    expect(await adminCancelExchange({ eventId: 99999 })).toEqual({
      error: "notFound",
    });
  });

  it("lists reports with target links and resolving sets resolvedAt", async () => {
    const ev = await mkEvent();
    const [r1] = await testDb
      .insert(abuseReports)
      .values({
        reporterMemberId: guest.id,
        targetType: "event",
        targetId: ev.id,
        reason: "spam",
        createdAt: iso(-2000),
      })
      .returning();
    await testDb.insert(abuseReports).values({
      reporterMemberId: guest.id,
      targetType: "member",
      targetId: host.id,
      reason: "abusive",
      createdAt: iso(-1000),
    });
    const list = await adminListReports("open");
    if ("error" in list) throw new Error(list.error);
    expect(list.data).toHaveLength(2);
    const evRow = list.data.find((r) => r.id === r1.id)!;
    expect(evRow).toMatchObject({
      targetType: "event",
      eventCode: ev.publicCode,
      targetName: ev.title,
      reporterName: "Guest B",
    });
    const memRow = list.data.find((r) => r.targetType === "member")!;
    expect(memRow.targetName).toBe("Host A");
    expect(memRow.eventCode).toBeNull();
    expect(JSON.stringify(list.data)).not.toContain("0900000001");
    expect(JSON.stringify(list.data)).not.toContain("host@example.com");

    expect(
      await adminResolveReport({ reportId: r1.id, status: "resolved" }),
    ).toEqual({ success: true });
    const [after] = await testDb
      .select()
      .from(abuseReports)
      .where(eq(abuseReports.id, r1.id));
    expect(after.status).toBe("resolved");
    expect(after.resolvedAt).not.toBeNull();
    const open = await adminListReports("open");
    if ("error" in open) throw new Error(open.error);
    expect(open.data).toHaveLength(1);

    expect(
      await adminResolveReport({ reportId: 99999, status: "dismissed" }),
    ).toEqual({ error: "notFound" });
    expect(
      await adminResolveReport({ reportId: r1.id, status: "open" }),
    ).toEqual({ error: "invalidInput" });
  });
});

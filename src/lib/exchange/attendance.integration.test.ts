import { describe, it, expect } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  venues,
  exchangeEvents,
  exchangeRegistrations,
  members,
} from "@/db/schema";
import type { ExchangeEventStatus, ExchangeRegStatus } from "./constants";

const { db: testDb } = await createTestDb();
const [venue] = await testDb
  .insert(venues)
  .values({ name: "V", lat: 10, lng: 106 })
  .returning();
const { attendanceStats, newAccountLimits } = await import("./attendance");

const NOW = "2026-11-05T00:00:00.000Z";
const FUTURE = "2099-01-01T10:00:00.000Z";
const PAST = "2020-01-01T10:00:00.000Z";

async function seedMember(approvalStatus: "approved" | "pending" = "pending") {
  const [m] = await testDb
    .insert(members)
    .values({ name: "m", approvalStatus })
    .returning({ id: members.id });
  return m.id;
}
async function seedEvent(
  o: {
    status?: ExchangeEventStatus;
    startAt?: string;
    hiddenAt?: string | null;
  } = {},
) {
  const host = await seedMember("approved");
  const [e] = await testDb
    .insert(exchangeEvents)
    .values({
      publicCode: Math.random().toString(36).slice(2, 12),
      hostMemberId: host,
      venueId: venue.id,
      title: "t",
      startAt: o.startAt ?? FUTURE,
      endAt: FUTURE,
      slotsTotal: 10,
      feeMode: "fixed",
      registerDeadline: FUTURE,
      cancelDeadline: FUTURE,
      status: o.status ?? "open",
      hiddenAt: o.hiddenAt ?? null,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .returning({ id: exchangeEvents.id });
  return e.id;
}
async function reg(
  eventId: number,
  memberId: number,
  status: ExchangeRegStatus,
  checkedIn = false,
) {
  await testDb.insert(exchangeRegistrations).values({
    eventId,
    memberId,
    status,
    maleCount: 1,
    checkedIn,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

describe("attendanceStats", () => {
  it("attendanceStats counts only checked-in registrations", async () => {
    const m = await seedMember();
    await reg(await seedEvent(), m, "approved", true);
    await reg(await seedEvent(), m, "approved", false);
    await reg(await seedEvent(), m, "no_show", false);
    expect(await attendanceStats(testDb, m)).toEqual({
      checkedIn: 1,
      approved: 2,
    });
  });
});

describe("newAccountLimits", () => {
  it("newAccountLimits: approved member never new; pending outsider with 0 check-ins is new; one check-in lifts it", async () => {
    const approved = await seedMember("approved");
    expect(
      await newAccountLimits(testDb, {
        id: approved,
        approvalStatus: "approved",
      }),
    ).toEqual({ isNew: false, waitingCount: 0 });

    const outsider = await seedMember("pending");
    const asOutsider = { id: outsider, approvalStatus: "pending" as const };
    expect((await newAccountLimits(testDb, asOutsider)).isNew).toBe(true);
    await reg(await seedEvent({ status: "done" }), outsider, "approved", true);
    expect((await newAccountLimits(testDb, asOutsider)).isNew).toBe(false);
  });

  it("waitingCount ignores registrations of cancelled or hidden events", async () => {
    const m = await seedMember("pending");
    await reg(await seedEvent(), m, "pending");
    await reg(await seedEvent({ status: "full" }), m, "waitlist");
    // These must not count:
    await reg(await seedEvent({ status: "cancelled" }), m, "pending");
    await reg(await seedEvent({ hiddenAt: NOW }), m, "pending");
    await reg(await seedEvent({ startAt: PAST }), m, "pending");
    await reg(await seedEvent({ status: "locked" }), m, "pending");
    await reg(await seedEvent(), m, "approved");
    await reg(await seedEvent(), m, "rejected");
    const r = await newAccountLimits(testDb, {
      id: m,
      approvalStatus: "pending",
    });
    expect(r.waitingCount).toBe(2);
  });
});

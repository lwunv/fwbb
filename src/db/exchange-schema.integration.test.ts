import { describe, it, expect } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  exchangeEvents,
  exchangeRegistrations,
  members,
  venues,
} from "@/db/schema";

const { db, client } = await createTestDb();

const now = new Date().toISOString();

const [member] = await db
  .insert(members)
  .values({ name: "Host", facebookId: "x-host" })
  .returning();
const [venue] = await db
  .insert(venues)
  .values({ name: "V", lat: 10, lng: 106 })
  .returning();

let seq = 0;
const eventRow = (over: Record<string, unknown> = {}) => ({
  publicCode: `code${++seq}`,
  hostMemberId: member.id,
  venueId: venue.id,
  title: "T",
  startAt: now,
  endAt: now,
  slotsTotal: 10,
  feeMode: "fixed" as const,
  registerDeadline: now,
  cancelDeadline: now,
  createdAt: now,
  updatedAt: now,
  ...over,
});

const [event] = await db.insert(exchangeEvents).values(eventRow()).returning();

const regRow = (over: Record<string, unknown> = {}) => ({
  eventId: event.id,
  memberId: member.id,
  status: "pending" as const,
  maleCount: 1,
  femaleCount: 0,
  createdAt: now,
  updatedAt: now,
  ...over,
});

describe("exchange schema", () => {
  it("creates the four exchange tables with every declared index", async () => {
    const r = await client.execute(
      "SELECT name FROM sqlite_master WHERE name LIKE 'exchange_%' OR name LIKE 'host_blocks%' OR name LIKE 'abuse_reports%'",
    );
    const names = r.rows.map((x) => String(x.name));
    for (const n of [
      "exchange_events",
      "exchange_registrations",
      "host_blocks",
      "abuse_reports",
      "exchange_events_public_code_unique",
      "exchange_events_idempotency_key_unique",
      "exchange_events_status_start_idx",
      "exchange_events_venue_start_idx",
      "exchange_events_host_start_idx",
      "exchange_registrations_event_member_unique",
      "exchange_registrations_event_status_idx",
      "exchange_registrations_member_status_idx",
      "exchange_registrations_member_checked_in_idx",
      "host_blocks_host_blocked_unique",
      "abuse_reports_reporter_target_unique",
      "abuse_reports_status_created_idx",
      "abuse_reports_target_idx",
    ]) {
      expect(names).toContain(n);
    }
  });

  it("registration (event, member) is unique", async () => {
    const [m2] = await db
      .insert(members)
      .values({ name: "M2", facebookId: "x-m2" })
      .returning();
    await db.insert(exchangeRegistrations).values(regRow({ memberId: m2.id }));
    await expect(
      db.insert(exchangeRegistrations).values(regRow({ memberId: m2.id })),
    ).rejects.toThrow();
  });

  it("negative fee_amount and paid_amount are rejected", async () => {
    const [m3] = await db
      .insert(members)
      .values({ name: "M3", facebookId: "x-m3" })
      .returning();
    await expect(
      db
        .insert(exchangeRegistrations)
        .values(regRow({ memberId: m3.id, feeAmount: -1 })),
    ).rejects.toThrow();
    await expect(
      db
        .insert(exchangeRegistrations)
        .values(regRow({ memberId: m3.id, paidAmount: -1 })),
    ).rejects.toThrow();
  });

  it("male_count + female_count = 0 is rejected", async () => {
    const [m4] = await db
      .insert(members)
      .values({ name: "M4", facebookId: "x-m4" })
      .returning();
    await expect(
      db
        .insert(exchangeRegistrations)
        .values(regRow({ memberId: m4.id, maleCount: 0, femaleCount: 0 })),
    ).rejects.toThrow();
  });

  it("female_reserved_slots above slots_total is rejected", async () => {
    await expect(
      db
        .insert(exchangeEvents)
        .values(eventRow({ slotsTotal: 4, femaleReservedSlots: 5 })),
    ).rejects.toThrow();
  });
});

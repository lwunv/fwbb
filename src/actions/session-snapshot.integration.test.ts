/**
 * Integration test: pricePerTube snapshot must NOT be overwritten when an
 * existing session_shuttlecocks row is updated. This is the production bug
 * we fixed in src/actions/sessions.ts:288-292.
 *
 * Uses an in-memory libsql DB with the real migration schema applied.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq, and } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import {
  sessions,
  courts,
  shuttlecockBrands,
  sessionShuttlecocks,
} from "@/db/schema";

// The action calls requireAdmin() and revalidatePath(); stub both.
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Replace the production db import with the in-memory test db.
const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

// Import AFTER the vi.mock so the action picks up the mocked db.
const { addSessionShuttlecocks } = await import("./sessions");

describe("addSessionShuttlecocks (integration)", () => {
  beforeEach(async () => {
    // Wipe state between tests
    await client.execute("DELETE FROM session_shuttlecocks");
    await client.execute("DELETE FROM sessions");
    await client.execute("DELETE FROM shuttlecock_brands");
    await client.execute("DELETE FROM courts");
  });

  it("does not overwrite pricePerTube snapshot when row already exists", async () => {
    // Seed: court, brand at 50k/tube, session referring to that court.
    const [court] = await testDb
      .insert(courts)
      .values({ name: "C1", pricePerSession: 200_000 })
      .returning({ id: courts.id });

    const [brand] = await testDb
      .insert(shuttlecockBrands)
      .values({ name: "Yonex", pricePerTube: 50_000 })
      .returning({ id: shuttlecockBrands.id });

    const [session] = await testDb
      .insert(sessions)
      .values({
        date: "2026-04-26",
        status: "confirmed",
        courtId: court.id,
        courtPrice: 200_000,
      })
      .returning({ id: sessions.id });

    // First call: snapshot brand price at 50k.
    const r1 = await addSessionShuttlecocks(session.id, brand.id, 6);
    expect(r1).toEqual({ success: true });

    let row = await testDb.query.sessionShuttlecocks.findFirst({
      where: and(
        eq(sessionShuttlecocks.sessionId, session.id),
        eq(sessionShuttlecocks.brandId, brand.id),
      ),
    });
    expect(row?.pricePerTube).toBe(50_000);
    expect(row?.quantityUsed).toBe(6);

    // Brand price changes after the session was used.
    await testDb
      .update(shuttlecockBrands)
      .set({ pricePerTube: 80_000 })
      .where(eq(shuttlecockBrands.id, brand.id));

    // Second call: admin corrects the quantity. pricePerTube MUST stay 50k.
    const r2 = await addSessionShuttlecocks(session.id, brand.id, 9);
    expect(r2).toEqual({ success: true });

    row = await testDb.query.sessionShuttlecocks.findFirst({
      where: and(
        eq(sessionShuttlecocks.sessionId, session.id),
        eq(sessionShuttlecocks.brandId, brand.id),
      ),
    });
    expect(row?.pricePerTube).toBe(50_000); // ← snapshot preserved
    expect(row?.quantityUsed).toBe(9);
  });

  it("rejects negative quantity via Zod", async () => {
    const [court] = await testDb
      .insert(courts)
      .values({ name: "C2", pricePerSession: 200_000 })
      .returning({ id: courts.id });
    const [brand] = await testDb
      .insert(shuttlecockBrands)
      .values({ name: "VS", pricePerTube: 30_000 })
      .returning({ id: shuttlecockBrands.id });
    const [session] = await testDb
      .insert(sessions)
      .values({
        date: "2026-04-27",
        status: "voting",
        courtId: court.id,
        courtPrice: 200_000,
      })
      .returning({ id: sessions.id });

    const r = await addSessionShuttlecocks(session.id, brand.id, -1);
    expect(r).toHaveProperty("error");
    expect("error" in r && r.error).toBeTruthy();
  });
});

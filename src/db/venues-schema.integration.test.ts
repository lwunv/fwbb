import { describe, it, expect } from "vitest";
import { createTestDb } from "@/db/test-db";
import { venues } from "@/db/schema";

const { db, client } = await createTestDb();

describe("venues schema", () => {
  it("migration tạo bảng venues + index", async () => {
    const r = await client.execute(
      "SELECT name FROM sqlite_master WHERE name IN ('venues','venues_status_lat_lng_idx')",
    );
    expect(r.rows.map((x) => x.name).sort()).toEqual([
      "venues",
      "venues_status_lat_lng_idx",
    ]);
  });

  it("courts có cột venue_id", async () => {
    const cols = await client.execute("PRAGMA table_info(courts)");
    expect(cols.rows.map((c) => c.name)).toContain("venue_id");
  });

  it("CHECK chặn giá âm", async () => {
    await expect(
      db
        .insert(venues)
        .values({ name: "X", lat: 21, lng: 105, refPricePerHour: -1 }),
    ).rejects.toThrow();
  });

  it("CHECK chặn số sân < 1", async () => {
    await expect(
      db.insert(venues).values({ name: "X", lat: 21, lng: 105, courtCount: 0 }),
    ).rejects.toThrow();
  });

  it("status mặc định pending, amenities mặc định []", async () => {
    const [v] = await db
      .insert(venues)
      .values({ name: "Y", lat: 21, lng: 105 })
      .returning();
    expect(v.status).toBe("pending");
    expect(v.amenities).toBe("[]");
  });
});

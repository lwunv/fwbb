/** Số sân chờ duyệt trên khung admin chỉ đếm đúng trạng thái `pending`. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { venues } from "@/db/schema";

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { countPendingVenues } = await import("./pending-venues");

async function seed(name: string, status: "pending" | "approved" | "hidden") {
  await testDb.insert(venues).values({ name, lat: 10.8, lng: 106.7, status });
}

beforeEach(async () => {
  await client.execute("DELETE FROM venues");
});

describe("countPendingVenues", () => {
  it("trả 0 khi chưa có sân nào", async () => {
    expect(await countPendingVenues()).toBe(0);
  });

  it("chỉ đếm sân pending, bỏ approved và hidden", async () => {
    await seed("A", "pending");
    await seed("B", "pending");
    await seed("C", "approved");
    await seed("D", "hidden");
    expect(await countPendingVenues()).toBe(2);
  });
});

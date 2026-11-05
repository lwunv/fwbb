import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { venues } from "@/db/schema";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));
vi.mock("@/lib/nominatim", () => ({ geocodeNominatim: vi.fn() }));
vi.mock("@/lib/client-ip", () => ({
  getTrustedClientIp: vi.fn(async () => "203.0.113.7"),
}));

const { db, client } = await createTestDb();
vi.mock("@/db", () => ({ db }));

const { listVenuesNear } = await import("./venues");

// Cứng tay (không import PUBLIC_VENUE_KEYS): thêm/bớt khoá lộ ra trang công
// khai phải đỏ test này và buộc người sửa cân nhắc rò rỉ dữ liệu.
const EXPECTED_KEYS = [
  "address",
  "amenities",
  "areaLabel",
  "courtCount",
  "distanceM",
  "id",
  "lat",
  "lng",
  "mapLink",
  "name",
  "openHours",
  "phone",
  "photoLink",
  "refPricePerHour",
];

const C = { lat: 21.03, lng: 105.85 };

beforeEach(async () => {
  await client.execute("DELETE FROM venues");
  vi.restoreAllMocks();
});

async function addVenue() {
  await db.insert(venues).values({
    name: "Sân A",
    address: "1 Phố X",
    lat: C.lat,
    lng: C.lng,
    status: "approved",
    amenities: JSON.stringify(["shower"]),
  });
}

describe("listVenuesNear shape", () => {
  it("listVenuesNear returns venue objects with exactly the current keys", async () => {
    await addVenue();
    const r = await listVenuesNear({ ...C, radiusKm: 5 });
    if ("error" in r) throw new Error(r.error);
    expect(r.venues).toHaveLength(1);
    expect(Object.keys(r.venues[0]).sort()).toEqual(EXPECTED_KEYS);
  });

  it("listVenuesNear reads app_settings zero times", async () => {
    await addVenue();
    const seen: string[] = [];
    const realExecute = client.execute.bind(client);
    vi.spyOn(client, "execute").mockImplementation(((
      stmt: string | { sql: string },
    ) => {
      seen.push(typeof stmt === "string" ? stmt : stmt.sql);
      return realExecute(stmt as never);
    }) as never);
    const selectSpy = vi.spyOn(db, "select");

    const r = await listVenuesNear({ ...C, radiusKm: 5 });
    if ("error" in r) throw new Error(r.error);
    expect(r.venues).toHaveLength(1);

    // Đối chứng: spy có bắt được truy vấn bảng venues.
    expect(selectSpy.mock.calls.length + seen.length).toBeGreaterThan(0);
    expect(seen.some((s) => s.includes('"venues"'))).toBe(true);
    expect(seen.filter((s) => s.includes("app_settings"))).toEqual([]);
  });
});

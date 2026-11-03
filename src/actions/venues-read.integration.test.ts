import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { venues } from "@/db/schema";
import { PUBLIC_VENUE_KEYS } from "@/lib/public-venue";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

const nomMock = vi.hoisted(() => ({ geocodeNominatim: vi.fn() }));
vi.mock("@/lib/nominatim", () => nomMock);
const ipMock = vi.hoisted(() => ({
  getTrustedClientIp: vi.fn(async () => "203.0.113.7"),
}));
vi.mock("@/lib/client-ip", () => ipMock);

const { db, client } = await createTestDb();
vi.mock("@/db", () => ({ db }));

const { listVenuesNear, getPublicVenue, geocodeAddress } =
  await import("./venues");

const C = { lat: 21.03, lng: 105.85 };
/** Điểm cách tâm `km` về phía bắc. */
const north = (km: number, from = C) => ({
  lat: from.lat + (km * 1000) / 111_320,
  lng: from.lng,
});
/** Điểm cách tâm `km` về phía đông. */
const east = (km: number, from = C) => ({
  lat: from.lat,
  lng:
    from.lng + (km * 1000) / (111_320 * Math.cos((from.lat * Math.PI) / 180)),
});

async function add(
  name: string,
  p: { lat: number; lng: number },
  extra: Partial<typeof venues.$inferInsert> = {},
) {
  await db.insert(venues).values({ name, ...p, status: "approved", ...extra });
}

const names = (r: Awaited<ReturnType<typeof listVenuesNear>>) => {
  if ("error" in r) throw new Error(r.error);
  return r.venues.map((v) => v.name);
};

beforeEach(async () => {
  await client.execute("DELETE FROM venues");
});

describe("listVenuesNear", () => {
  it("chỉ trả sân approved, sắp theo khoảng cách", async () => {
    await add("S4km", north(4));
    await add("S1km", north(1));
    await add("S2km", east(2));
    await add("Pending", north(0.5), { status: "pending" });
    await add("Hidden", north(0.3), { status: "hidden" });
    expect(names(await listVenuesNear({ ...C, radiusKm: 5 }))).toEqual([
      "S1km",
      "S2km",
      "S4km",
    ]);
  });

  it("loại sân ngoài bán kính dù nằm trong khung vuông (góc khung)", async () => {
    await add("Corner", east(4.5, north(4.5)));
    expect(names(await listVenuesNear({ ...C, radiusKm: 5 }))).toEqual([]);
  });

  it("người đứng lệch 0,004° khỏi tâm ô lưới vẫn thấy sân ở 4,9 km", async () => {
    const me = { lat: 21.034, lng: 105.854 };
    await add("Edge", north(4.9, me));
    await add("Edge2", east(-4.9, me));
    expect(names(await listVenuesNear({ ...me, radiusKm: 5 })).sort()).toEqual([
      "Edge",
      "Edge2",
    ]);
  });

  it("payload chỉ gồm cột whitelist + distanceM", async () => {
    await add("S", north(1), { submittedByMemberId: null });
    const r = await listVenuesNear({ ...C, radiusKm: 5 });
    if ("error" in r) throw new Error(r.error);
    expect(Object.keys(r.venues[0]).sort()).toEqual(
      [...PUBLIC_VENUE_KEYS, "distanceM"].sort(),
    );
  });

  it("lọc tiện ích: phải có đủ mọi tiện ích đã chọn", async () => {
    await add("Both", north(1), { amenities: '["parking","air_con"]' });
    await add("One", north(2), { amenities: '["parking"]' });
    expect(
      names(
        await listVenuesNear({
          ...C,
          radiusKm: 5,
          amenities: ["parking", "air_con"],
        }),
      ),
    ).toEqual(["Both"]);
  });

  it("amenities hỏng trong DB không làm vỡ cả danh sách", async () => {
    await add("Bad", north(1), { amenities: "not json" });
    const r = await listVenuesNear({ ...C, radiusKm: 5 });
    if ("error" in r) throw new Error(r.error);
    expect(r.venues[0].amenities).toEqual([]);
  });

  it("tối đa 50 kết quả", async () => {
    for (let i = 0; i < 60; i++) await add(`S${i}`, north(0.05 * i));
    const r = await listVenuesNear({ ...C, radiusKm: 5 });
    if ("error" in r) throw new Error(r.error);
    expect(r.venues).toHaveLength(50);
  });

  it("danh bạ lớn (>200 sân trong khung): sân gần nhất vẫn có dù thêm vào cuối", async () => {
    const values = Array.from({ length: 220 }, (_, i) => ({
      name: `Far${i}`,
      // Phía NAM tâm (vĩ độ thấp hơn) để thứ tự index (status, lat, lng) đưa
      // chúng lên trước sân gần nhất — không thì test xanh nhờ may.
      ...north(-(4 + (i % 10) * 0.05)),
      status: "approved" as const,
    }));
    await db.insert(venues).values(values);
    await add("Nearest", north(0.2));
    const r = await listVenuesNear({ ...C, radiusKm: 5 });
    if ("error" in r) throw new Error(r.error);
    expect(r.venues[0].name).toBe("Nearest");
  });

  it("lọc tiện ích chạy trước khi cắt ứng viên: sân có tiện ích ở xa hơn 200 sân khác vẫn ra", async () => {
    const values = Array.from({ length: 220 }, (_, i) => ({
      name: `Plain${i}`,
      ...north(0.5 + i * 0.001),
      status: "approved" as const,
    }));
    await db.insert(venues).values(values);
    await add("WithShower", north(4), { amenities: '["shower"]' });
    expect(
      names(await listVenuesNear({ ...C, radiusKm: 5, amenities: ["shower"] })),
    ).toEqual(["WithShower"]);
  });

  it("lat/lng không hợp lệ hoặc radius lạ → error", async () => {
    expect(
      await listVenuesNear({ lat: NaN, lng: 105, radiusKm: 5 }),
    ).toHaveProperty("error");
    expect(
      await listVenuesNear({ ...C, radiusKm: 7 as unknown as 5 }),
    ).toHaveProperty("error");
  });
});

describe("getPublicVenue", () => {
  it("trả sân approved, null với pending/không tồn tại", async () => {
    await add("A", north(1));
    await add("P", north(2), { status: "pending" });
    const rows = await db.select().from(venues);
    const a = rows.find((r) => r.name === "A")!;
    const p = rows.find((r) => r.name === "P")!;
    expect((await getPublicVenue(a.id))?.name).toBe("A");
    expect(await getPublicVenue(p.id)).toBeNull();
    expect(await getPublicVenue(999_999)).toBeNull();
  });
});

describe("geocodeAddress", () => {
  beforeEach(async () => {
    nomMock.geocodeNominatim.mockReset();
    await client.execute("DELETE FROM rate_limit_buckets");
  });

  it("chuẩn hoá chuỗi rồi trả toạ độ", async () => {
    nomMock.geocodeNominatim.mockResolvedValueOnce({
      status: "ok",
      lat: 21.02,
      lng: 105.85,
      label: "Hoàn Kiếm",
    });
    expect(await geocodeAddress("  Hoàn   Kiếm ")).toEqual({
      lat: 21.02,
      lng: 105.85,
      label: "Hoàn Kiếm",
    });
    expect(nomMock.geocodeNominatim).toHaveBeenCalledWith("hoàn kiếm");
  });

  it("không tìm thấy → venueAddressNotFound", async () => {
    nomMock.geocodeNominatim.mockResolvedValueOnce({ status: "not_found" });
    expect(await geocodeAddress("abc")).toEqual({
      error: "venueAddressNotFound",
    });
  });

  it("lỗi tạm thời/bận → venueGeocodeUnavailable, và không chặn lần thử sau", async () => {
    nomMock.geocodeNominatim.mockResolvedValueOnce({ status: "error" });
    expect(await geocodeAddress("abc")).toEqual({
      error: "venueGeocodeUnavailable",
    });
    nomMock.geocodeNominatim.mockResolvedValueOnce({ status: "busy" });
    expect(await geocodeAddress("abc")).toEqual({
      error: "venueGeocodeUnavailable",
    });
    nomMock.geocodeNominatim.mockResolvedValueOnce({
      status: "ok",
      lat: 21,
      lng: 105.8,
      label: "abc",
    });
    expect(await geocodeAddress("abc")).toHaveProperty("lat", 21);
  });

  it("quá 10 lần/phút từ cùng IP → error, không gọi Nominatim", async () => {
    nomMock.geocodeNominatim.mockResolvedValue({ status: "not_found" });
    for (let i = 0; i < 10; i++) await geocodeAddress(`q${i}`);
    nomMock.geocodeNominatim.mockClear();
    expect(await geocodeAddress("q-extra")).toEqual({
      error: "tooManyActions",
    });
    expect(nomMock.geocodeNominatim).not.toHaveBeenCalled();
  });

  it("xoay IP vẫn bị trần chung 60 lần/phút (bảo vệ nhịp của Nominatim)", async () => {
    nomMock.geocodeNominatim.mockResolvedValue({ status: "not_found" });
    for (let i = 0; i < 60; i++) {
      ipMock.getTrustedClientIp.mockResolvedValueOnce(`198.51.100.${i}`);
      await geocodeAddress(`g${i}`);
    }
    nomMock.geocodeNominatim.mockClear();
    ipMock.getTrustedClientIp.mockResolvedValueOnce("198.51.100.250");
    expect(await geocodeAddress("g-extra")).toEqual({
      error: "venueGeocodeUnavailable",
    });
    expect(nomMock.geocodeNominatim).not.toHaveBeenCalled();
  });

  it("IPv6 cùng /64 dùng chung một giới hạn", async () => {
    nomMock.geocodeNominatim.mockResolvedValue({ status: "not_found" });
    for (let i = 0; i < 10; i++) {
      ipMock.getTrustedClientIp.mockResolvedValueOnce(`2001:db8:1:2::${i + 1}`);
      await geocodeAddress(`v6-${i}`);
    }
    ipMock.getTrustedClientIp.mockResolvedValueOnce("2001:db8:1:2:ffff::9");
    expect(await geocodeAddress("v6-extra")).toEqual({
      error: "tooManyActions",
    });
  });

  it("rỗng hoặc quá dài → error, không gọi Nominatim", async () => {
    expect(await geocodeAddress("  ")).toHaveProperty("error");
    expect(await geocodeAddress("x".repeat(201))).toHaveProperty("error");
    expect(nomMock.geocodeNominatim).not.toHaveBeenCalled();
  });
});

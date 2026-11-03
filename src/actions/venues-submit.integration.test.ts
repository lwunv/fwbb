import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members, venues } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

const userMock = vi.hoisted(() => ({
  getUserFromCookie:
    vi.fn<() => Promise<{ memberId: number; externalId: string } | null>>(),
}));
vi.mock("@/lib/user-identity", () => userMock);

const resolveMock = vi.hoisted(() => ({ resolveMapsLink: vi.fn() }));
vi.mock("@/lib/maps-link-resolve", () => resolveMock);

const { db, client } = await createTestDb();
vi.mock("@/db", () => ({ db }));

const { submitVenue } = await import("./venues");

let MEMBER_ID = 0;

beforeEach(async () => {
  await client.execute("DELETE FROM venues");
  await client.execute("DELETE FROM rate_limit_buckets");
  await client.execute("DELETE FROM members");
  const [m] = await db
    .insert(members)
    .values({ name: "Tester", facebookId: "fb-tester" })
    .returning();
  MEMBER_ID = m.id;
  userMock.getUserFromCookie.mockResolvedValue({
    memberId: MEMBER_ID,
    externalId: "fb-tester",
  });
  resolveMock.resolveMapsLink.mockReset();
});

describe("submitVenue", () => {
  it("member chưa duyệt → error, không ghi", async () => {
    await db
      .update(members)
      .set({ approvalStatus: "pending" })
      .where(eq(members.id, MEMBER_ID));
    expect(
      await submitVenue({ name: "A", lat: 21.03, lng: 105.85 }),
    ).toHaveProperty("error");
    expect(await db.select().from(venues)).toHaveLength(0);
  });

  it("chưa đăng nhập → error", async () => {
    userMock.getUserFromCookie.mockResolvedValue(null);
    expect(
      await submitVenue({ name: "A", lat: 21.03, lng: 105.85 }),
    ).toHaveProperty("error");
  });

  it("link không tách được toạ độ, không có lat/lng → error rõ ràng", async () => {
    resolveMock.resolveMapsLink.mockResolvedValueOnce(null);
    const r = await submitVenue({
      name: "A",
      mapLink: "https://maps.app.goo.gl/x",
    });
    expect(r).toEqual({ error: "venueNoCoordinates" });
    expect(await db.select().from(venues)).toHaveLength(0);
  });

  it("lấy toạ độ từ link khi không nhập lat/lng", async () => {
    resolveMock.resolveMapsLink.mockResolvedValueOnce({
      lat: 21.0312,
      lng: 105.8423,
    });
    const r = await submitVenue({
      name: "A",
      mapLink: "https://maps.app.goo.gl/x",
    });
    expect(r).toHaveProperty("success", true);
    const [v] = await db.select().from(venues);
    expect([v.lat, v.lng]).toEqual([21.0312, 105.8423]);
    expect(v.mapLink).toBe("https://maps.app.goo.gl/x");
  });

  it("toạ độ ngoài VN → error", async () => {
    expect(await submitVenue({ name: "A", lat: 35, lng: 139 })).toHaveProperty(
      "error",
    );
  });

  it("link resolve ra toạ độ ngoài VN → error", async () => {
    resolveMock.resolveMapsLink.mockResolvedValueOnce({ lat: 35, lng: 139 });
    expect(
      await submitVenue({ name: "A", mapLink: "https://maps.app.goo.gl/x" }),
    ).toHaveProperty("error");
  });

  it("không có cả link lẫn toạ độ → error", async () => {
    expect(await submitVenue({ name: "A" })).toHaveProperty("error");
  });

  it("lưu pending, ghi submittedByMemberId", async () => {
    const r = await submitVenue({
      name: "Sân A",
      lat: 21.03,
      lng: 105.85,
      amenities: ["parking"],
      refPricePerHour: 120000,
    });
    const [v] = await db.select().from(venues);
    expect(r).toEqual({ success: true, id: v.id });
    expect(v.status).toBe("pending");
    expect(v.submittedByMemberId).toBe(MEMBER_ID);
    expect(JSON.parse(v.amenities)).toEqual(["parking"]);
    expect(v.refPricePerHour).toBe(120000);
  });

  it("giá lẻ (không nguyên) → error", async () => {
    expect(
      await submitVenue({
        name: "A",
        lat: 21.03,
        lng: 105.85,
        refPricePerHour: 120000.5,
      }),
    ).toHaveProperty("error");
  });

  it("sân cách < 100 m → trả duplicate, chưa ghi; confirmDuplicate=true thì ghi", async () => {
    await submitVenue({ name: "Sân A", lat: 21.03, lng: 105.85 });
    const r = await submitVenue({
      name: "Sân A2",
      lat: 21.0303,
      lng: 105.8502,
    });
    expect(r).toEqual({
      duplicate: {
        id: expect.any(Number),
        name: "Sân A",
        distanceM: expect.any(Number),
        isPublic: false,
      },
    });
    expect(await db.select().from(venues)).toHaveLength(1);
    expect(
      await submitVenue({
        name: "Sân A2",
        lat: 21.0303,
        lng: 105.8502,
        confirmDuplicate: true,
      }),
    ).toHaveProperty("success", true);
    expect(await db.select().from(venues)).toHaveLength(2);
  });

  it("sân đã bị ẩn không tính là trùng", async () => {
    await db
      .insert(venues)
      .values({ name: "Ẩn", lat: 21.03, lng: 105.85, status: "hidden" });
    expect(
      await submitVenue({ name: "Mới", lat: 21.0301, lng: 105.8501 }),
    ).toHaveProperty("success", true);
  });

  it("lần gửi lỗi và lần bị báo trùng không tính vào giới hạn ngày", async () => {
    resolveMock.resolveMapsLink.mockResolvedValue(null);
    for (let i = 0; i < 3; i++) {
      expect(
        await submitVenue({
          name: "Lỗi",
          mapLink: "https://maps.app.goo.gl/x",
        }),
      ).toHaveProperty("error");
    }
    await submitVenue({ name: "Gốc", lat: 21.03, lng: 105.85 });
    expect(
      await submitVenue({ name: "Trùng", lat: 21.0301, lng: 105.8501 }),
    ).toHaveProperty("duplicate");
    expect(
      await submitVenue({
        name: "Trùng",
        lat: 21.0301,
        lng: 105.8501,
        confirmDuplicate: true,
      }),
    ).toHaveProperty("success", true);
  });

  it("gửi song song 5 lần cùng lúc → chỉ tạo đúng 3 sân", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        submitVenue({
          name: `P${i}`,
          lat: 21 + i * 0.1,
          lng: 105.85,
          confirmDuplicate: true,
        }),
      ),
    );
    expect(results.filter((r) => "success" in r)).toHaveLength(3);
    expect(await db.select().from(venues)).toHaveLength(3);
  });

  it("gửi lỗi liên tục quá 10 lần/phút → bị chặn trước khi resolve link", async () => {
    resolveMock.resolveMapsLink.mockResolvedValue(null);
    for (let i = 0; i < 10; i++) {
      await submitVenue({ name: "Lỗi", mapLink: "https://maps.app.goo.gl/x" });
    }
    resolveMock.resolveMapsLink.mockClear();
    expect(
      await submitVenue({ name: "Lỗi", mapLink: "https://maps.app.goo.gl/x" }),
    ).toEqual({ error: "tooManyActions" });
    expect(resolveMock.resolveMapsLink).not.toHaveBeenCalled();
  });

  it("quá 3 lần/ngày → error", async () => {
    for (let i = 0; i < 3; i++) {
      expect(
        await submitVenue({ name: `S${i}`, lat: 21 + i * 0.1, lng: 105.85 }),
      ).toHaveProperty("success", true);
    }
    expect(await submitVenue({ name: "S4", lat: 21.5, lng: 105.85 })).toEqual({
      error: "venueSubmitLimit",
    });
  });
});

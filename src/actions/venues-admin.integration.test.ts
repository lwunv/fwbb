import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { courts, members, venues } from "@/db/schema";
import { eq } from "drizzle-orm";

const cacheMock = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("next/cache", () => cacheMock);
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

const authMock = vi.hoisted(() => ({
  requireAdmin: vi.fn(
    async () =>
      ({ admin: { sub: "1", role: "admin" } }) as
        | { admin: { sub: string; role: string } }
        | { error: string },
  ),
}));
vi.mock("@/lib/auth", () => authMock);

const { db, client } = await createTestDb();
vi.mock("@/db", () => ({ db }));

const { listVenuesForReview, setVenueStatus, updateVenue, listVenuesNear } =
  await import("./venues");
const { linkCourtToVenue } = await import("./courts");

let venueId = 0;
let courtId = 0;

beforeEach(async () => {
  await client.execute("UPDATE courts SET venue_id = NULL");
  await client.execute("DELETE FROM venues");
  await client.execute("DELETE FROM courts");
  await client.execute("DELETE FROM members");
  authMock.requireAdmin.mockResolvedValue({
    admin: { sub: "1", role: "admin" },
  });
  cacheMock.updateTag.mockClear();
  const [m] = await db
    .insert(members)
    .values({ name: "Người đề xuất", facebookId: "fb-sub" })
    .returning();
  const [v] = await db
    .insert(venues)
    .values({
      name: "Sân A",
      lat: 21.03,
      lng: 105.85,
      submittedByMemberId: m.id,
    })
    .returning();
  venueId = v.id;
  const [c] = await db
    .insert(courts)
    .values({ name: "Sân nhóm", pricePerSession: 200_000 })
    .returning();
  courtId = c.id;
});

describe("admin venue actions", () => {
  it("không phải admin → error, không đổi", async () => {
    authMock.requireAdmin.mockResolvedValue({ error: "unauthorized" });
    expect(await setVenueStatus(venueId, "approved")).toHaveProperty("error");
    const [v] = await db.select().from(venues);
    expect(v.status).toBe("pending");
    expect(await listVenuesForReview("pending")).toEqual([]);
  });

  it("listVenuesForReview trả kèm tên người đề xuất", async () => {
    const rows = await listVenuesForReview("pending");
    expect(rows).toHaveLength(1);
    expect(rows[0].submittedByName).toBe("Người đề xuất");
  });

  it("approve: status=approved, approvedAt có giá trị, updateTag('venues')", async () => {
    expect(await setVenueStatus(venueId, "approved")).toEqual({
      success: true,
    });
    const [v] = await db.select().from(venues);
    expect(v.status).toBe("approved");
    expect(v.approvedAt).toBeTruthy();
    expect(cacheMock.updateTag).toHaveBeenCalledWith("venues");
  });

  it("approve làm tươi layout admin để số sân chờ duyệt cập nhật", async () => {
    cacheMock.revalidatePath.mockClear();
    await setVenueStatus(venueId, "approved");
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/admin", "layout");
  });

  it("hidden: sân biến mất khỏi listVenuesNear", async () => {
    await setVenueStatus(venueId, "approved");
    await setVenueStatus(venueId, "hidden");
    const r = await listVenuesNear({ lat: 21.03, lng: 105.85, radiusKm: 3 });
    expect("venues" in r && r.venues).toEqual([]);
  });

  it("setVenueStatus với id không tồn tại → error", async () => {
    expect(await setVenueStatus(999_999, "approved")).toHaveProperty("error");
  });

  it("updateVenue sửa thông tin, validate như lúc đề xuất", async () => {
    expect(
      await updateVenue(venueId, {
        name: "Sân A mới",
        lat: 21.04,
        lng: 105.86,
        courtCount: 8,
      }),
    ).toEqual({ success: true });
    const [v] = await db.select().from(venues);
    expect([v.name, v.lat, v.courtCount]).toEqual(["Sân A mới", 21.04, 8]);
    expect(
      await updateVenue(venueId, { name: "X", lat: 35, lng: 139 }),
    ).toHaveProperty("error");
  });

  it("linkCourtToVenue với venue không tồn tại → error", async () => {
    expect(await linkCourtToVenue(courtId, 999_999)).toHaveProperty("error");
  });

  it("linkCourtToVenue nối/bỏ nối, không đổi pricePerSession", async () => {
    expect(await linkCourtToVenue(courtId, venueId)).toEqual({ success: true });
    let [c] = await db.select().from(courts).where(eq(courts.id, courtId));
    expect(c.venueId).toBe(venueId);
    expect(c.pricePerSession).toBe(200_000);
    expect(await linkCourtToVenue(courtId, null)).toEqual({ success: true });
    [c] = await db.select().from(courts).where(eq(courts.id, courtId));
    expect(c.venueId).toBeNull();
  });
});

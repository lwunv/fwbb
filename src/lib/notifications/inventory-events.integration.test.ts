import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  admins,
  appSettings,
  inventoryPurchases,
  members,
  notifications,
  sessionShuttlecocks,
  sessions,
  shuttlecockBrands,
} from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
  getAdminFromCookie: vi.fn(async () => ({ sub: "1", role: "admin" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { getStockByBrand } = await import("@/actions/inventory");
const { computeStockByBrand } = await import("@/lib/inventory-stock");
const { checkLowStockAndNotify } = await import("./inventory-events");
const { enableNotificationsForTest } = await import("./test-helpers");

async function reset() {
  for (const t of [
    "notifications",
    "notification_prefs",
    "inventory_purchases",
    "session_shuttlecocks",
    "sessions",
    "shuttlecock_brands",
    "admins",
    "members",
    "app_settings",
  ]) {
    await client.execute(`DELETE FROM ${t}`).catch(() => undefined);
  }
}

async function addBrand(name: string, adjust = 0, isActive = true) {
  const [b] = await testDb
    .insert(shuttlecockBrands)
    .values({ name, pricePerTube: 250000, stockAdjustQua: adjust, isActive })
    .returning({ id: shuttlecockBrands.id });
  return b.id;
}
async function addPurchase(brandId: number, tubes: number) {
  const [p] = await testDb
    .insert(inventoryPurchases)
    .values({
      brandId,
      tubes,
      pricePerTube: 250000,
      totalPrice: tubes * 250000,
      purchasedAt: "2026-11-01",
    })
    .returning({ id: inventoryPurchases.id });
  return p.id;
}
let day = 0;
async function addUsage(
  brandId: number,
  qua: number,
  status: "completed" | "cancelled" = "completed",
) {
  const [s] = await testDb
    .insert(sessions)
    .values({ date: `2027-01-${String(++day).padStart(2, "0")}`, status })
    .returning({ id: sessions.id });
  await testDb.insert(sessionShuttlecocks).values({
    sessionId: s.id,
    brandId,
    quantityUsed: qua,
    pricePerTube: 250000,
  });
}
async function addSuperadmin() {
  const [m] = await testDb
    .insert(members)
    .values({ name: "Chau", facebookId: "fb-chau" })
    .returning({ id: members.id });
  const [a] = await testDb
    .insert(admins)
    .values({ username: "adm", passwordHash: "x", memberId: m.id })
    .returning({ id: admins.id });
  return a.id;
}
const lowNotices = () =>
  testDb
    .select()
    .from(notifications)
    .where(eq(notifications.kind, "low_stock"));

beforeEach(async () => {
  day = 0;
  await reset();
});

describe("computeStockByBrand", () => {
  it("matches the previous getStockByBrand output on the same data", async () => {
    const a = await addBrand("Alpha", 3);
    const b = await addBrand("Beta", 0, false);
    await addPurchase(a, 2); // 24 qua
    await addPurchase(a, 1); // +12 = 36
    await addPurchase(b, 1); // 12
    await addUsage(a, 10);
    await addUsage(a, 7, "cancelled"); // not counted
    await addUsage(b, 20); // raw -8

    // Captured from the pre-extraction getStockByBrand (threshold 12).
    const expected = [
      {
        brandId: a,
        brandName: "Alpha",
        pricePerTube: 250000,
        isActive: true,
        totalPurchasedTubes: 3,
        totalPurchasedQua: 36,
        totalUsedQua: 10,
        adjustQua: 3,
        currentStockQua: 29,
        rawStockQua: 29,
        ong: 2,
        qua: 5,
        isLowStock: false,
      },
      {
        brandId: b,
        brandName: "Beta",
        pricePerTube: 250000,
        isActive: false,
        totalPurchasedTubes: 1,
        totalPurchasedQua: 12,
        totalUsedQua: 20,
        adjustQua: 0,
        currentStockQua: 0,
        rawStockQua: -8,
        ong: 0,
        qua: 0,
        isLowStock: true,
      },
    ];
    expect(await computeStockByBrand(testDb)).toEqual(expected);
    expect(await getStockByBrand()).toEqual(expected);
  });
});

describe("checkLowStockAndNotify", () => {
  it("does nothing while the switch is off", async () => {
    const a = await addBrand("Alpha");
    await addPurchase(a, 1);
    await addSuperadmin();
    await checkLowStockAndNotify(testDb);
    expect(await lowNotices()).toHaveLength(0);
  });

  it("low stock notifies once per purchase cycle; a new purchase then low again notifies again", async () => {
    await enableNotificationsForTest(testDb);
    const adminId = await addSuperadmin();
    const a = await addBrand("Alpha");
    await addBrand("Idle", 0, false); // inactive brand: never alerts
    const p1 = await addPurchase(a, 1); // 12 qua, threshold 12 -> ok
    await addUsage(a, 5); // 7 < 12 -> low
    await checkLowStockAndNotify(testDb);
    await checkLowStockAndNotify(testDb); // same cycle: deduped
    let rows = await lowNotices();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      recipientType: "admin",
      recipientId: adminId,
      dedupKey: `lowstock:b${a}:p${p1}:a${adminId}`,
      entityType: "brand",
      entityId: a,
    });
    expect(rows[0].payload).toEqual({ brandName: "Alpha", stockQua: 7 });

    // Restock, not low -> no new notice.
    await addPurchase(a, 3); // 48 - 5 = 43
    await checkLowStockAndNotify(testDb);
    expect(await lowNotices()).toHaveLength(1);

    // Use it down again: a new cycle (new last purchase id) notifies again.
    await addUsage(a, 40); // 3
    await checkLowStockAndNotify(testDb);
    rows = await lowNotices();
    expect(rows).toHaveLength(2);
    expect(rows[1].dedupKey).not.toBe(rows[0].dedupKey);
    expect(rows[1].payload).toEqual({ brandName: "Alpha", stockQua: 3 });
  });

  it("respects the lowStockThresholdQua setting", async () => {
    await enableNotificationsForTest(testDb);
    await addSuperadmin();
    const a = await addBrand("Alpha");
    await addPurchase(a, 1); // 12
    await checkLowStockAndNotify(testDb);
    expect(await lowNotices()).toHaveLength(0);
    await testDb
      .insert(appSettings)
      .values({ key: "lowStockThresholdQua", value: "20" });
    await checkLowStockAndNotify(testDb);
    expect(await lowNotices()).toHaveLength(1);
  });
});

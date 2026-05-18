/**
 * Integration tests for inventory actions:
 *  - recordPurchase: idempotent insert via UNIQUE idempotencyKey
 *  - updatePurchaseTubes: delta ledger sync (positive/negative)
 *  - setStockQua: adjustQua delta inside tx, F14 (skip cancelled sessions)
 *  - getStockByBrand: F14 (cancelled sessions don't count as "used")
 *
 * F14 fix (bdbd148): align stock calc with F7 revenue-calc — cancelled
 * sessions' sessionShuttlecocks rows are NOT counted as used. Admin records
 * physical loss via setStockQua/stockAdjustQua.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  sessions,
  admins,
  shuttlecockBrands,
  inventoryPurchases,
  sessionShuttlecocks,
  financialTransactions,
} from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { recordPurchase, updatePurchaseTubes, setStockQua, getStockByBrand } =
  await import("./inventory");

async function reset() {
  await client.execute("DELETE FROM financial_transactions");
  await client.execute("DELETE FROM session_shuttlecocks");
  await client.execute("DELETE FROM inventory_purchases");
  await client.execute("DELETE FROM sessions");
  await client.execute("DELETE FROM shuttlecock_brands");
  await client.execute("DELETE FROM admins");
}

async function seedAdmin() {
  const [a] = await testDb
    .insert(admins)
    .values({ username: "admin", passwordHash: "hash" })
    .returning({ id: admins.id });
  return a.id;
}

async function seedBrand(opts: { name?: string; pricePerTube?: number } = {}) {
  const [b] = await testDb
    .insert(shuttlecockBrands)
    .values({
      name: opts.name ?? "Test Brand",
      pricePerTube: opts.pricePerTube ?? 300_000,
    })
    .returning({ id: shuttlecockBrands.id });
  return b.id;
}

async function seedSession(
  status: "voting" | "confirmed" | "completed" | "cancelled" = "completed",
  date = "2026-04-10",
) {
  const [s] = await testDb
    .insert(sessions)
    .values({ date, status, courtPrice: 200_000 })
    .returning({ id: sessions.id });
  return s.id;
}

function buildPurchaseForm(
  brandId: number,
  tubes: number,
  pricePerTube: number,
  idempotencyKey: string,
): FormData {
  const fd = new FormData();
  fd.set("brandId", String(brandId));
  fd.set("tubes", String(tubes));
  fd.set("pricePerTube", String(pricePerTube));
  fd.set("purchasedAt", "2026-04-10");
  fd.set("idempotencyKey", idempotencyKey);
  return fd;
}

describe("recordPurchase (integration)", () => {
  beforeEach(async () => {
    await reset();
    await seedAdmin();
  });

  it("inserts inventory_purchase + ledger row atomically", async () => {
    const brandId = await seedBrand();
    const r = await recordPurchase(
      buildPurchaseForm(brandId, 5, 300_000, "key-1"),
    );
    expect(r).toEqual({ success: true });

    const purchases = await testDb.query.inventoryPurchases.findMany({});
    expect(purchases).toHaveLength(1);
    expect(purchases[0].tubes).toBe(5);
    expect(purchases[0].totalPrice).toBe(5 * 300_000);

    const txs = await testDb.query.financialTransactions.findMany({});
    expect(txs).toHaveLength(1);
    expect(txs[0].type).toBe("inventory_purchase");
    expect(txs[0].direction).toBe("out");
    expect(txs[0].amount).toBe(1_500_000);
    expect(txs[0].idempotencyKey).toBe("key-1");
  });

  it("idempotent on double-submit with same idempotencyKey", async () => {
    const brandId = await seedBrand();
    const fd1 = buildPurchaseForm(brandId, 5, 300_000, "key-dup");
    const fd2 = buildPurchaseForm(brandId, 5, 300_000, "key-dup");

    const r1 = await recordPurchase(fd1);
    const r2 = await recordPurchase(fd2);
    expect(r1).toEqual({ success: true });
    expect(r2).toEqual({ success: true });

    // No double-insert.
    const purchases = await testDb.query.inventoryPurchases.findMany({});
    expect(purchases).toHaveLength(1);

    const txs = await testDb.query.financialTransactions.findMany({});
    expect(txs).toHaveLength(1);
  });

  it("rejects missing idempotencyKey", async () => {
    const brandId = await seedBrand();
    const fd = buildPurchaseForm(brandId, 5, 300_000, "");
    const r = await recordPurchase(fd);
    expect("error" in r).toBe(true);
  });
});

describe("updatePurchaseTubes (integration)", () => {
  beforeEach(async () => {
    await reset();
    await seedAdmin();
  });

  it("positive delta inserts additional inventory_purchase tx (direction=out)", async () => {
    const brandId = await seedBrand();
    await recordPurchase(buildPurchaseForm(brandId, 5, 300_000, "init"));
    const purchase = (await testDb.query.inventoryPurchases.findMany({}))[0];

    const r = await updatePurchaseTubes(purchase.id, 8, "delta-up");
    expect(r).toEqual({ success: true });

    const updated = await testDb.query.inventoryPurchases.findFirst({
      where: eq(inventoryPurchases.id, purchase.id),
    });
    expect(updated?.tubes).toBe(8);
    expect(updated?.totalPrice).toBe(8 * 300_000);

    const txs = await testDb.query.financialTransactions.findMany({});
    expect(txs).toHaveLength(2);
    const delta = txs.find((t) => t.idempotencyKey?.includes("delta-up"));
    expect(delta?.direction).toBe("out");
    expect(delta?.amount).toBe(3 * 300_000); // (8-5)*price
  });

  it("negative delta inserts inventory_purchase tx (direction=in)", async () => {
    const brandId = await seedBrand();
    await recordPurchase(buildPurchaseForm(brandId, 5, 300_000, "init"));
    const purchase = (await testDb.query.inventoryPurchases.findMany({}))[0];

    const r = await updatePurchaseTubes(purchase.id, 3, "delta-down");
    expect(r).toEqual({ success: true });

    const updated = await testDb.query.inventoryPurchases.findFirst({
      where: eq(inventoryPurchases.id, purchase.id),
    });
    expect(updated?.tubes).toBe(3);
    expect(updated?.totalPrice).toBe(3 * 300_000);

    const txs = await testDb.query.financialTransactions.findMany({});
    const delta = txs.find((t) => t.idempotencyKey?.includes("delta-down"));
    expect(delta?.direction).toBe("in");
    expect(delta?.amount).toBe(2 * 300_000); // |3-5|*price
  });

  it("zero delta — no new ledger row", async () => {
    const brandId = await seedBrand();
    await recordPurchase(buildPurchaseForm(brandId, 5, 300_000, "init"));
    const purchase = (await testDb.query.inventoryPurchases.findMany({}))[0];

    const before = await testDb.query.financialTransactions.findMany({});
    const r = await updatePurchaseTubes(purchase.id, 5, "no-op");
    expect(r).toEqual({ success: true });

    const after = await testDb.query.financialTransactions.findMany({});
    expect(after).toHaveLength(before.length);
  });

  it("rejects tubes < 1", async () => {
    const brandId = await seedBrand();
    await recordPurchase(buildPurchaseForm(brandId, 5, 300_000, "init"));
    const purchase = (await testDb.query.inventoryPurchases.findMany({}))[0];

    const r = await updatePurchaseTubes(purchase.id, 0, "bad");
    expect("error" in r).toBe(true);
  });
});

describe("getStockByBrand — F14: skip cancelled sessions", () => {
  beforeEach(async () => {
    await reset();
    await seedAdmin();
  });

  it("subtracts used qua from COMPLETED sessions only", async () => {
    const brandId = await seedBrand();
    await recordPurchase(buildPurchaseForm(brandId, 10, 300_000, "purchase-1")); // 120 quả

    const completedId = await seedSession("completed");
    await testDb.insert(sessionShuttlecocks).values({
      sessionId: completedId,
      brandId,
      quantityUsed: 10,
      pricePerTube: 300_000,
    });

    const stock = await getStockByBrand();
    const brand = stock.find((s) => s.brandId === brandId);
    expect(brand?.totalPurchasedQua).toBe(120);
    expect(brand?.totalUsedQua).toBe(10);
    expect(brand?.currentStockQua).toBe(110);
  });

  it("CANCELLED session's sessionShuttlecocks rows NOT counted as used (F14)", async () => {
    const brandId = await seedBrand();
    await recordPurchase(buildPurchaseForm(brandId, 10, 300_000, "purchase-1")); // 120 quả

    const cancelledId = await seedSession("cancelled");
    await testDb.insert(sessionShuttlecocks).values({
      sessionId: cancelledId,
      brandId,
      quantityUsed: 15,
      pricePerTube: 300_000,
    });

    const stock = await getStockByBrand();
    const brand = stock.find((s) => s.brandId === brandId);
    // F14: cancelled session's 15 quả KHÔNG bị trừ vào used
    expect(brand?.totalUsedQua).toBe(0);
    expect(brand?.currentStockQua).toBe(120);
  });

  it("mixed completed + cancelled — only completed counts toward used", async () => {
    const brandId = await seedBrand();
    await recordPurchase(buildPurchaseForm(brandId, 10, 300_000, "purchase-1")); // 120 quả

    const completedId = await seedSession("completed", "2026-04-10");
    const cancelledId = await seedSession("cancelled", "2026-04-12");
    await testDb.insert(sessionShuttlecocks).values([
      {
        sessionId: completedId,
        brandId,
        quantityUsed: 5,
        pricePerTube: 300_000,
      },
      {
        sessionId: cancelledId,
        brandId,
        quantityUsed: 8,
        pricePerTube: 300_000,
      },
    ]);

    const stock = await getStockByBrand();
    const brand = stock.find((s) => s.brandId === brandId);
    expect(brand?.totalUsedQua).toBe(5);
    expect(brand?.currentStockQua).toBe(115);
  });

  it("respects stockAdjustQua delta", async () => {
    const brandId = await seedBrand();
    await testDb
      .update(shuttlecockBrands)
      .set({ stockAdjustQua: 7 })
      .where(eq(shuttlecockBrands.id, brandId));
    await recordPurchase(buildPurchaseForm(brandId, 10, 300_000, "stock-adj"));

    const stock = await getStockByBrand();
    const brand = stock.find((s) => s.brandId === brandId);
    expect(brand?.adjustQua).toBe(7);
    expect(brand?.currentStockQua).toBe(120 + 7); // 127
  });

  it("low stock badge fires when < 12 quả", async () => {
    const brandId = await seedBrand();
    await recordPurchase(buildPurchaseForm(brandId, 1, 300_000, "purchase-1")); // 12 quả
    const completedId = await seedSession("completed");
    await testDb.insert(sessionShuttlecocks).values({
      sessionId: completedId,
      brandId,
      quantityUsed: 6, // còn 6
      pricePerTube: 300_000,
    });

    const stock = await getStockByBrand();
    const brand = stock.find((s) => s.brandId === brandId);
    expect(brand?.currentStockQua).toBe(6);
    expect(brand?.isLowStock).toBe(true);
  });

  it("display clamps negative stock to 0 but preserves raw", async () => {
    const brandId = await seedBrand();
    await recordPurchase(buildPurchaseForm(brandId, 1, 300_000, "purchase-1")); // 12 quả
    const completedId = await seedSession("completed");
    await testDb.insert(sessionShuttlecocks).values({
      sessionId: completedId,
      brandId,
      quantityUsed: 20, // over-use → raw = -8
      pricePerTube: 300_000,
    });

    const stock = await getStockByBrand();
    const brand = stock.find((s) => s.brandId === brandId);
    expect(brand?.rawStockQua).toBe(-8);
    expect(brand?.currentStockQua).toBe(0);
  });
});

describe("setStockQua — F14: cancelled sessions excluded from current stock calc", () => {
  beforeEach(async () => {
    await reset();
    await seedAdmin();
  });

  it("adjusts delta toward desired qua (no cancelled noise)", async () => {
    const brandId = await seedBrand();
    await recordPurchase(buildPurchaseForm(brandId, 1, 300_000, "purchase-1")); // 12 quả
    const completedId = await seedSession("completed");
    await testDb.insert(sessionShuttlecocks).values({
      sessionId: completedId,
      brandId,
      quantityUsed: 4, // current = 12 - 4 = 8
      pricePerTube: 300_000,
    });

    const r = await setStockQua(brandId, 20); // want +12
    expect(r).toEqual({ success: true });

    const brand = await testDb.query.shuttlecockBrands.findFirst({
      where: eq(shuttlecockBrands.id, brandId),
    });
    expect(brand?.stockAdjustQua).toBe(12); // 0 + (20 - 8)
  });

  it("cancelled session shuttlecocks don't shift current stock baseline (F14)", async () => {
    const brandId = await seedBrand();
    await recordPurchase(buildPurchaseForm(brandId, 1, 300_000, "purchase-1")); // 12 quả
    const cancelledId = await seedSession("cancelled");
    await testDb.insert(sessionShuttlecocks).values({
      sessionId: cancelledId,
      brandId,
      quantityUsed: 10, // BEFORE F14 fix: current would be 12-10=2 → adjust = 8.
      // AFTER F14: cancelled ignored → current = 12 → adjust = 8 (different baseline).
      pricePerTube: 300_000,
    });

    const r = await setStockQua(brandId, 20);
    expect(r).toEqual({ success: true });

    const brand = await testDb.query.shuttlecockBrands.findFirst({
      where: eq(shuttlecockBrands.id, brandId),
    });
    // current pre-set = 12 (cancelled skipped) → desired 20 → delta = 8
    expect(brand?.stockAdjustQua).toBe(8);
  });

  it("no-op when desiredQua matches current", async () => {
    const brandId = await seedBrand();
    await recordPurchase(buildPurchaseForm(brandId, 1, 300_000, "purchase-1")); // 12 quả
    const r = await setStockQua(brandId, 12);
    expect(r).toEqual({ success: true });

    const brand = await testDb.query.shuttlecockBrands.findFirst({
      where: eq(shuttlecockBrands.id, brandId),
    });
    expect(brand?.stockAdjustQua).toBe(0);
  });

  it("rejects negative desiredQua", async () => {
    const brandId = await seedBrand();
    const r = await setStockQua(brandId, -1);
    expect("error" in r).toBe(true);
  });
});

"use server";

import { db } from "@/db";
import {
  inventoryPurchases,
  sessionShuttlecocks,
  shuttlecockBrands,
} from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { purchaseSchema } from "@/lib/validators";
import { recordFinancialTransaction } from "@/lib/financial-ledger";
import { requireAdmin } from "@/lib/auth";

export async function recordPurchase(formData: FormData) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const parsed = purchaseSchema.safeParse({
    brandId: Number(formData.get("brandId")),
    tubes: Number(formData.get("tubes")),
    pricePerTube: Number(formData.get("pricePerTube")),
    purchasedAt: formData.get("purchasedAt") as string,
    notes: (formData.get("notes") as string) || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const totalPrice = parsed.data.tubes * parsed.data.pricePerTube;

  const [purchase] = await db
    .insert(inventoryPurchases)
    .values({
      brandId: parsed.data.brandId,
      tubes: parsed.data.tubes,
      pricePerTube: parsed.data.pricePerTube,
      totalPrice,
      purchasedAt: parsed.data.purchasedAt,
      notes: parsed.data.notes ?? null,
    })
    .returning({ id: inventoryPurchases.id });

  await recordFinancialTransaction({
    type: "inventory_purchase",
    direction: "out",
    amount: totalPrice,
    inventoryPurchaseId: purchase.id,
    description: parsed.data.notes || "Mua cầu",
    metadata: {
      brandId: parsed.data.brandId,
      tubes: parsed.data.tubes,
      pricePerTube: parsed.data.pricePerTube,
    },
  });

  revalidatePath("/admin/inventory");
  return { success: true };
}

export async function updatePurchaseTubes(purchaseId: number, tubes: number) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  if (!Number.isInteger(purchaseId) || purchaseId <= 0) {
    return { error: "purchaseId không hợp lệ" };
  }
  if (!Number.isInteger(tubes) || tubes < 1 || tubes > 10000) {
    return { error: "Số ống phải là số nguyên 1-10000" };
  }

  const purchase = await db.query.inventoryPurchases.findFirst({
    where: eq(inventoryPurchases.id, purchaseId),
  });
  if (!purchase) return { error: "Không tìm thấy" };

  const newTotalPrice = tubes * purchase.pricePerTube;
  const priceDelta = newTotalPrice - purchase.totalPrice;

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(inventoryPurchases)
        .set({ tubes, totalPrice: newTotalPrice })
        .where(eq(inventoryPurchases.id, purchaseId));

      // Keep the ledger in sync: record the delta as an additional purchase
      // (or a refund if delta < 0) tied to the same inventoryPurchaseId, so
      // total spend on shuttlecocks computed from the ledger matches reality.
      if (priceDelta !== 0) {
        const r = await recordFinancialTransaction(
          {
            type: "inventory_purchase",
            direction: priceDelta > 0 ? "out" : "in",
            amount: Math.abs(priceDelta),
            inventoryPurchaseId: purchaseId,
            description:
              priceDelta > 0
                ? `Điều chỉnh mua thêm cầu (#${purchaseId}): ${tubes - purchase.tubes} ống`
                : `Hoàn lại điều chỉnh giảm mua cầu (#${purchaseId}): ${purchase.tubes - tubes} ống`,
            metadata: {
              purchaseId,
              previousTubes: purchase.tubes,
              newTubes: tubes,
              priceDelta,
            },
          },
          tx,
        );
        if ("error" in r) throw new Error(r.error);
      }
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Không cập nhật được ống cầu",
    };
  }

  revalidatePath("/admin/inventory");
  return { success: true };
}

export async function setStockQua(brandId: number, desiredQua: number) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  if (!Number.isInteger(brandId) || brandId <= 0) {
    return { error: "brandId không hợp lệ" };
  }
  if (!Number.isInteger(desiredQua) || desiredQua < 0 || desiredQua > 100000) {
    return { error: "Số lượng không hợp lệ" };
  }

  // Run read-then-write in a transaction so two admins editing concurrently
  // don't double-apply the same delta.
  try {
    await db.transaction(async (tx) => {
      const brand = await tx.query.shuttlecockBrands.findFirst({
        where: eq(shuttlecockBrands.id, brandId),
      });
      if (!brand) throw new Error("Không tìm thấy hãng cầu");

      const purchases = await tx.query.inventoryPurchases.findMany({
        where: eq(inventoryPurchases.brandId, brandId),
        columns: { tubes: true },
      });
      const usage = await tx.query.sessionShuttlecocks.findMany({
        where: eq(sessionShuttlecocks.brandId, brandId),
        columns: { quantityUsed: true },
      });
      const adjustQua = brand.stockAdjustQua ?? 0;
      const totalPurchasedQua = purchases.reduce((s, p) => s + p.tubes, 0) * 12;
      const totalUsedQua = usage.reduce((s, u) => s + u.quantityUsed, 0);
      const currentStock = totalPurchasedQua - totalUsedQua + adjustQua;

      if (desiredQua === currentStock) return;

      const newAdjust = adjustQua + (desiredQua - currentStock);
      await tx
        .update(shuttlecockBrands)
        .set({ stockAdjustQua: newAdjust })
        .where(eq(shuttlecockBrands.id, brandId));
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Không cập nhật được tồn kho",
    };
  }

  revalidatePath("/admin/inventory");
  return { success: true };
}

export interface StockByBrand {
  brandId: number;
  brandName: string;
  pricePerTube: number;
  isActive: boolean;
  totalPurchasedTubes: number;
  totalPurchasedQua: number;
  totalUsedQua: number;
  adjustQua: number;
  /** Display-clamped stock (≥ 0) — what UI shows. */
  currentStockQua: number;
  /** Real (un-clamped) stock — can be negative when usage > purchases.
   * Useful for admin debugging "why is stock 0?" — keeps the actual delta. */
  rawStockQua: number;
  ong: number; // tubes in stock
  qua: number; // remaining qua after full tubes
  isLowStock: boolean;
}

export async function getStockByBrand(): Promise<StockByBrand[]> {
  // Get all brands
  const brands = await db.query.shuttlecockBrands.findMany({
    orderBy: (b, { asc }) => [asc(b.name)],
  });

  // Get all purchases
  const purchases = await db.query.inventoryPurchases.findMany();

  // Get all usage from sessions
  const usage = await db.query.sessionShuttlecocks.findMany();

  const result: StockByBrand[] = [];

  for (const brand of brands) {
    // Sum purchased tubes for this brand
    const totalPurchasedTubes = purchases
      .filter((p) => p.brandId === brand.id)
      .reduce((sum, p) => sum + p.tubes, 0);

    const totalPurchasedQua = totalPurchasedTubes * 12;

    // Sum used qua for this brand
    const totalUsedQua = usage
      .filter((u) => u.brandId === brand.id)
      .reduce((sum, u) => sum + u.quantityUsed, 0);

    const adjustQua = brand.stockAdjustQua ?? 0;
    const currentStockQua = totalPurchasedQua - totalUsedQua + adjustQua;

    // Convert to ong + qua display
    const ong = Math.floor(Math.max(0, currentStockQua) / 12);
    const qua = Math.max(0, currentStockQua) % 12;

    result.push({
      brandId: brand.id,
      brandName: brand.name,
      pricePerTube: brand.pricePerTube,
      isActive: brand.isActive ?? true,
      totalPurchasedTubes,
      totalPurchasedQua,
      totalUsedQua,
      adjustQua,
      currentStockQua: Math.max(0, currentStockQua),
      rawStockQua: currentStockQua,
      ong,
      qua,
      isLowStock: currentStockQua < 12, // less than 1 tube
    });
  }

  return result;
}

export async function getPurchaseHistory() {
  return db.query.inventoryPurchases.findMany({
    orderBy: [desc(inventoryPurchases.purchasedAt)],
    with: { brand: true },
  });
}

export async function getUsageHistory() {
  return db.query.sessionShuttlecocks.findMany({
    orderBy: [desc(sessionShuttlecocks.id)],
    with: {
      brand: true,
      session: true,
    },
  });
}

export async function checkLowStock(): Promise<{
  isLow: boolean;
  totalQua: number;
  items: StockByBrand[];
}> {
  const stock = await getStockByBrand();
  const activeStock = stock.filter((s) => s.isActive);
  const totalQua = activeStock.reduce((sum, s) => sum + s.currentStockQua, 0);
  return {
    isLow: totalQua < 12,
    totalQua,
    items: activeStock,
  };
}

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

export async function recordPurchase(formData: FormData) {
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

  await db.insert(inventoryPurchases).values({
    brandId: parsed.data.brandId,
    tubes: parsed.data.tubes,
    pricePerTube: parsed.data.pricePerTube,
    totalPrice,
    purchasedAt: parsed.data.purchasedAt,
    notes: parsed.data.notes ?? null,
  });

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
  currentStockQua: number;
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

    const currentStockQua = totalPurchasedQua - totalUsedQua;

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
      currentStockQua: Math.max(0, currentStockQua),
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

export async function checkLowStock(): Promise<{ isLow: boolean; totalQua: number; items: StockByBrand[] }> {
  const stock = await getStockByBrand();
  const activeStock = stock.filter((s) => s.isActive);
  const totalQua = activeStock.reduce((sum, s) => sum + s.currentStockQua, 0);
  return {
    isLow: totalQua < 12,
    totalQua,
    items: activeStock,
  };
}

import { appSettings } from "@/db/schema";
import type { DbOrTx } from "@/db/tx";
import { resolveGlobal } from "@/lib/settings-resolve";
import {
  tubesToQua,
  isLowStock,
  splitOngQua,
  computeCurrentStock,
} from "@/lib/inventory-core";

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

/**
 * Tồn kho từng hãng, tính từ dữ liệu gốc (mua − dùng + điều chỉnh). Không
 * kiểm quyền: caller tự gác (`getStockByBrand` đòi admin, tin kho chạy sau
 * commit của action admin).
 */
export async function computeStockByBrand(db: DbOrTx): Promise<StockByBrand[]> {
  const settingRows = await db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings);
  const { lowStockThresholdQua } = resolveGlobal(settingRows);

  const brands = await db.query.shuttlecockBrands.findMany({
    orderBy: (b, { asc }) => [asc(b.name)],
  });
  const purchases = await db.query.inventoryPurchases.findMany();

  // Cancelled sessions retain sessionShuttlecocks rows but their tubes are NOT
  // counted as "used" by stock — matches the F7 convention in
  // shuttlecock-finance. Admin records physical loss via `setStockQua` /
  // `stockAdjustQua` if tubes were opened then session cancelled.
  const usage = await db.query.sessionShuttlecocks.findMany({
    with: { session: { columns: { status: true } } },
  });

  const result: StockByBrand[] = [];

  for (const brand of brands) {
    const totalPurchasedTubes = purchases
      .filter((p) => p.brandId === brand.id)
      .reduce((sum, p) => sum + p.tubes, 0);

    const totalPurchasedQua = tubesToQua(totalPurchasedTubes);

    const totalUsedQua = usage
      .filter(
        (u) => u.brandId === brand.id && u.session?.status !== "cancelled",
      )
      .reduce((sum, u) => sum + u.quantityUsed, 0);

    const adjustQua = brand.stockAdjustQua ?? 0;
    const { rawStockQua, currentStockQua } = computeCurrentStock({
      purchasedQua: totalPurchasedQua,
      usedQua: totalUsedQua,
      adjustQua,
    });

    const { ong, qua } = splitOngQua(currentStockQua);

    result.push({
      brandId: brand.id,
      brandName: brand.name,
      pricePerTube: brand.pricePerTube,
      isActive: brand.isActive ?? true,
      totalPurchasedTubes,
      totalPurchasedQua,
      totalUsedQua,
      adjustQua,
      currentStockQua,
      rawStockQua,
      ong,
      qua,
      isLowStock: isLowStock(rawStockQua, lowStockThresholdQua),
    });
  }

  return result;
}

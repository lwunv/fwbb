import { desc, eq } from "drizzle-orm";
import { inventoryPurchases } from "@/db/schema";
import type { DbOrTx } from "@/db/tx";
import { computeStockByBrand } from "@/lib/inventory-stock";
import { runAfterResponse } from "./after";
import { isNotificationsEnabled, notify } from "./notify";
import { superadminRecipients } from "./recipients";

/**
 * Báo admin khi hãng đang dùng có tồn thật dưới ngưỡng `lowStockThresholdQua`.
 * Công tắc tắt thì return ngay sau 1 lần đọc setting, không quét kho.
 * Chống trùng theo "chu kỳ nhập": mã lần nhập gần nhất của hãng; nhập cầu mới
 * thì sang chu kỳ mới, xuống thấp lần nữa sẽ báo lại.
 */
export async function checkLowStockAndNotify(db: DbOrTx): Promise<void> {
  const on = await isNotificationsEnabled(db);
  if (!on) return;

  const low = (await computeStockByBrand(db)).filter(
    (s) => s.isActive && s.isLowStock,
  );
  if (low.length === 0) return;

  const recipients = await superadminRecipients(db);
  for (const s of low) {
    const [last] = await db
      .select({ id: inventoryPurchases.id })
      .from(inventoryPurchases)
      .where(eq(inventoryPurchases.brandId, s.brandId))
      .orderBy(desc(inventoryPurchases.id))
      .limit(1);
    await notify(db, {
      kind: "low_stock",
      recipients,
      payload: { brandName: s.brandName, stockQua: s.rawStockQua },
      dedupBase: `lowstock:b${s.brandId}:p${last?.id ?? 0}`,
      entity: { type: "brand", id: s.brandId },
      gate: on,
    });
  }
}

/**
 * Gọi SAU khi transaction của action kho/chốt sổ đã commit. Tin này là dữ
 * liệu suy ra từ tồn kho (không phải nghiệp vụ tiền), nên ghi NGOÀI tx là chủ
 * ý: lỗi ở đây không được làm rollback lần chốt sổ/nhập kho đã xong. Cờ tắt
 * thì không hẹn gì cả. `gate` là công tắc caller đã đọc sẵn.
 */
export async function scheduleLowStockCheck(
  db: DbOrTx,
  gate?: boolean,
): Promise<void> {
  try {
    if (!(gate ?? (await isNotificationsEnabled(db)))) return;
    runAfterResponse(() => checkLowStockAndNotify(db));
  } catch {
    // Tiền đã commit: không để lỗi đọc công tắc làm action báo lỗi sai.
    console.error("[Notify] lowstock_schedule_failed");
  }
}

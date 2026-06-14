/**
 * inventory-core — single source of truth for shuttlecock stock math.
 *
 * Pure functions only (no DB, no React, no "use client"). Inventory accuracy
 * is CRITICAL: these values feed session cost calculation. See AGENTS.md for
 * the stock model. Do NOT change the math — only centralize it here.
 */

/** Quả (shuttlecocks) per tube (ống). 1 ống = 12 quả. */
export const QUA_PER_TUBE = 12;

/**
 * Low-stock threshold in quả. Below 1 full tube (< 12 quả) is considered low
 * and surfaced with a warning badge in the UI.
 */
export const LOW_STOCK_THRESHOLD_QUA = 12;

/**
 * Convert a tube count to quả. `totalPurchasedQua = SUM(purchase.tubes) × 12`.
 * @param tubes number of tubes (ống)
 * @returns equivalent quả
 */
export function tubesToQua(tubes: number): number {
  return tubes * QUA_PER_TUBE;
}

/**
 * Whether a stock level (in quả) counts as low (< 1 tube). Pass the RAW
 * (possibly negative) stock value to match existing behavior — a negative
 * stock is, of course, also low.
 * @param currentStockQua stock in quả (raw or clamped)
 */
export function isLowStock(currentStockQua: number): boolean {
  return currentStockQua < LOW_STOCK_THRESHOLD_QUA;
}

/**
 * Split a quả count into whole tubes (ống) + leftover quả for display.
 * Mirrors the existing inline logic: `ong = floor(qua / 12)`, `qua = qua % 12`.
 * Callers pass an already non-negative quả count (use the clamped
 * currentStockQua) — this function does not clamp.
 * @param qua non-negative quả count
 * @returns { ong: whole tubes, qua: remaining quả after full tubes }
 */
export function splitOngQua(qua: number): { ong: number; qua: number } {
  return {
    ong: Math.floor(qua / QUA_PER_TUBE),
    qua: qua % QUA_PER_TUBE,
  };
}

/**
 * Compute current stock from source data:
 *   rawStockQua = purchasedQua − usedQua + adjustQua
 *   currentStockQua = max(0, rawStockQua)
 * The raw (un-clamped, possibly negative) value is preserved for debugging
 * "why is stock 0?"; UI uses the clamped value.
 * @param input.purchasedQua total purchased quả (tubes × 12)
 * @param input.usedQua total used quả (sum of quantityUsed)
 * @param input.adjustQua manual correction delta (stockAdjustQua)
 * @returns { rawStockQua, currentStockQua }
 */
export function computeCurrentStock(input: {
  purchasedQua: number;
  usedQua: number;
  adjustQua: number;
}): { rawStockQua: number; currentStockQua: number } {
  const rawStockQua = input.purchasedQua - input.usedQua + input.adjustQua;
  return {
    rawStockQua,
    currentStockQua: Math.max(0, rawStockQua),
  };
}

/**
 * Pure financial-summary helpers — bucket ledger rows by economic meaning.
 *
 * Reason: `financial_transactions` mixes three economic categories under the
 * same `direction` flag (in/out). Summing `direction=in` (or `out`) blindly
 * double-counts because:
 *   - `bank_payment_received` is an AUDIT row, paired with a real
 *     `fund_contribution`; counting both = ×2 the real money in.
 *   - `fund_deduction` is internal redistribution (admin allocating an
 *     already-paid expense to members); counting it alongside
 *     `inventory_purchase`/`court_rent_payment` = ×2 the real money out.
 *   - Legacy `debt_member_confirmed`/`debt_admin_confirmed` direction=in but
 *     are audit-only in the merged Quỹ+Nợ model.
 *
 * This helper buckets a list of ledger rows into:
 *   - `realIn`  — money actually entering admin's wallet (counted once).
 *   - `realOut` — money actually leaving admin's wallet (counted once).
 *   - `fundDeductions` — internal allocation total, exposed for audit but
 *      EXPLICITLY excluded from realOut.
 *
 * Reversal pairs are filtered out: both the reversal row (reversalOfId set)
 * AND the row it points at (id appears in some other row's reversalOfId)
 * are dropped, so a +X/−X pair contributes 0 to every bucket.
 */

export interface LedgerRowForSummary {
  id: number;
  type: string;
  direction: "in" | "out" | "neutral" | string;
  amount: number;
  reversalOfId: number | null;
}

export interface MonthlyCashFlow {
  /** fund_contribution + manual_adjustment(in). */
  realIn: number;
  /** fund_refund + inventory_purchase + court_rent_payment + manual_adjustment(out). */
  realOut: number;
  /** Subset of realOut — type = inventory_purchase. */
  inventorySpend: number;
  /** Subset of realOut — type = court_rent_payment. */
  courtRentSpend: number;
  /** Subset of realOut — type = fund_refund. */
  fundRefundSpend: number;
  /**
   * Sum of fund_deduction in the window. NOT real cash out — internal
   * redistribution of expenses already paid. Exposed so reconcile / audit
   * surfaces can compare `fundDeductions ≈ inventorySpend + courtRentSpend`
   * (within rounding tolerance).
   */
  fundDeductions: number;
}

export function bucketMonthlyTransactions(
  rows: LedgerRowForSummary[],
): MonthlyCashFlow {
  const reversedIds = new Set<number>();
  for (const r of rows) {
    if (r.reversalOfId != null) reversedIds.add(r.reversalOfId);
  }

  let realIn = 0;
  let realOut = 0;
  let inventorySpend = 0;
  let courtRentSpend = 0;
  let fundRefundSpend = 0;
  let fundDeductions = 0;

  for (const r of rows) {
    if (r.reversalOfId != null) continue;
    if (reversedIds.has(r.id)) continue;

    switch (r.type) {
      case "fund_contribution":
        realIn += r.amount;
        break;
      case "manual_adjustment":
        if (r.direction === "in") realIn += r.amount;
        else if (r.direction === "out") realOut += r.amount;
        break;
      case "fund_refund":
        realOut += r.amount;
        fundRefundSpend += r.amount;
        break;
      case "inventory_purchase":
        realOut += r.amount;
        inventorySpend += r.amount;
        break;
      case "court_rent_payment":
        realOut += r.amount;
        courtRentSpend += r.amount;
        break;
      case "fund_deduction":
        fundDeductions += r.amount;
        break;
      // bank_payment_received: audit-only, paired with fund_contribution → skip.
      // debt_created / debt_member_confirmed / debt_admin_confirmed / debt_undo:
      //   audit-only in merged Quỹ+Nợ model → skip.
    }
  }

  return {
    realIn,
    realOut,
    inventorySpend,
    courtRentSpend,
    fundRefundSpend,
    fundDeductions,
  };
}

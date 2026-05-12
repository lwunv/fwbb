/**
 * Pure fund deduction calculation — no DB dependencies.
 * Safe to import anywhere including tests and Server Components.
 */

export interface FundBalance {
  memberId: number;
  totalContributions: number;
  totalDeductions: number;
  totalRefunds: number;
  balance: number;
}

export interface FundDeductionResult {
  deductedFromFund: number;
  remainingDebt: number;
  fullyPaidByFund: boolean;
}

/**
 * Calculate fund balance from a list of transactions.
 * balance = SUM(contributions) - SUM(deductions) - SUM(refunds)
 *
 * All values are integers (VND). No floats.
 *
 * Reversal pair handling: if a row has `reversalOfId`, both the reversal AND
 * the original it points at are excluded from totals. This prevents lifetime
 * stat inflation after admin hủy giao dịch (otherwise +X contribution stays
 * in `totalContributions` and the offsetting -X reversal lands in
 * `totalRefunds` — both inflate while net balance correctly nets to 0).
 *
 * Callers passing only `{type, amount}` (legacy/tests) get the same result as
 * before because the void-pair filter is no-op without id/reversalOfId info.
 *
 * ⚠ INVARIANT — bank_payment_received KHÔNG cộng vào balance ở đây.
 * Mỗi lần `payment-matcher` ghi `bank_payment_received` (audit/source of
 * truth), nó BẮT BUỘC ghi kèm 1 `fund_contribution` paired để balance member
 * mới update (xem `payment-matcher.ts` các chỗ `idempotencyKey:
 * "bank-payment-balance-..."`). Nếu tương lai ai đó insert
 * `bank_payment_received` mà QUÊN row `fund_contribution` đi kèm → balance
 * sẽ drift. Reconcile invariant I8 catch được phần debt-confirm flag nhưng
 * không catch trực tiếp việc thiếu paired row → khi refactor matcher phải
 * giữ pattern paired insert.
 */
export function computeBalanceFromTransactions(
  memberId: number,
  transactions: Array<{
    type: string;
    amount: number;
    id?: number;
    reversalOfId?: number | null;
  }>,
): FundBalance {
  // First pass: collect ids that are reversed by another row in this list.
  const voidedIds = new Set<number>();
  for (const tx of transactions) {
    if (tx.reversalOfId !== undefined && tx.reversalOfId !== null) {
      voidedIds.add(tx.reversalOfId);
    }
  }

  let totalContributions = 0;
  let totalDeductions = 0;
  let totalRefunds = 0;

  for (const tx of transactions) {
    // Reversal entry itself — exclude (the original it points at is also
    // excluded below, so the pair drops out cleanly).
    if (tx.reversalOfId !== undefined && tx.reversalOfId !== null) continue;
    // Original that has been voided by some reversal in this list — exclude.
    if (tx.id !== undefined && voidedIds.has(tx.id)) continue;

    switch (tx.type) {
      case "fund_contribution":
        totalContributions += tx.amount;
        break;
      case "fund_deduction":
        totalDeductions += tx.amount;
        break;
      case "fund_refund":
        totalRefunds += tx.amount;
        break;
    }
  }

  return {
    memberId,
    totalContributions,
    totalDeductions,
    totalRefunds,
    balance: totalContributions - totalDeductions - totalRefunds,
  };
}

/**
 * Calculate how much of a debt can be covered by the fund.
 * Does NOT write to DB — caller handles inserts.
 *
 * @param balance - Current fund balance (integer VND)
 * @param debtAmount - Total debt amount (integer VND)
 */
export function calculateFundDeduction(
  balance: number,
  debtAmount: number,
): FundDeductionResult {
  if (balance <= 0 || debtAmount <= 0) {
    return {
      deductedFromFund: 0,
      remainingDebt: debtAmount,
      fullyPaidByFund: false,
    };
  }

  if (balance >= debtAmount) {
    return {
      deductedFromFund: debtAmount,
      remainingDebt: 0,
      fullyPaidByFund: true,
    };
  }

  return {
    deductedFromFund: balance,
    remainingDebt: debtAmount - balance,
    fullyPaidByFund: false,
  };
}

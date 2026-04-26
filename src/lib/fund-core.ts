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
 */
export function computeBalanceFromTransactions(
  memberId: number,
  transactions: Array<{ type: string; amount: number }>,
): FundBalance {
  let totalContributions = 0;
  let totalDeductions = 0;
  let totalRefunds = 0;

  for (const tx of transactions) {
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

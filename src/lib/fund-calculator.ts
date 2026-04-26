import { db } from "@/db";
import { financialTransactions, fundMembers } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { computeBalanceFromTransactions } from "./fund-core";

// Re-export pure types and functions for consumers
export {
  calculateFundDeduction,
  computeBalanceFromTransactions,
} from "./fund-core";
export type { FundBalance, FundDeductionResult } from "./fund-core";

/**
 * Calculate fund balance for a single member from the DB.
 */
export async function getFundBalance(memberId: number) {
  const txs = await db.query.financialTransactions.findMany({
    where: eq(financialTransactions.memberId, memberId),
  });

  return computeBalanceFromTransactions(memberId, txs);
}

/**
 * Get fund balances for all active fund members.
 */
export async function getAllFundBalances() {
  const activeMembers = await db.query.fundMembers.findMany({
    where: eq(fundMembers.isActive, true),
  });

  const balances = [];
  for (const fm of activeMembers) {
    balances.push(await getFundBalance(fm.memberId));
  }

  return balances;
}

/**
 * Check if a member is an active fund member.
 */
export async function isFundMember(memberId: number): Promise<boolean> {
  const fm = await db.query.fundMembers.findFirst({
    where: and(
      eq(fundMembers.memberId, memberId),
      eq(fundMembers.isActive, true),
    ),
  });
  return !!fm;
}

"use server";

import { db } from "@/db";
import { financialTransactions, fundMembers, members } from "@/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getFundBalance, getAllFundBalances } from "@/lib/fund-calculator";
import { recordFinancialTransaction } from "@/lib/financial-ledger";
import { requireAdmin } from "@/lib/auth";
import { formatVND } from "@/lib/utils";

type FundTransactionType =
  | "fund_contribution"
  | "fund_deduction"
  | "fund_refund";
const FUND_TRANSACTION_TYPES: FundTransactionType[] = [
  "fund_contribution",
  "fund_deduction",
  "fund_refund",
];

// ─── Fund Member Management ───

export async function addFundMember(memberId: number) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  // Check if member exists
  const member = await db.query.members.findFirst({
    where: eq(members.id, memberId),
  });
  if (!member) return { error: "Không tìm thấy thành viên" };

  // Check if already a fund member
  const existing = await db.query.fundMembers.findFirst({
    where: eq(fundMembers.memberId, memberId),
  });

  if (existing) {
    if (existing.isActive) return { error: "Thành viên đã trong quỹ" };

    // Re-activate
    await db
      .update(fundMembers)
      .set({ isActive: true, leftAt: null, joinedAt: new Date().toISOString() })
      .where(eq(fundMembers.id, existing.id));
  } else {
    await db.insert(fundMembers).values({ memberId });
  }

  revalidatePath("/admin/fund");
  revalidatePath("/my-fund");
  return { success: true };
}

export async function removeFundMember(
  memberId: number,
  refundBalance: boolean = true,
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const fm = await db.query.fundMembers.findFirst({
    where: and(
      eq(fundMembers.memberId, memberId),
      eq(fundMembers.isActive, true),
    ),
  });
  if (!fm) return { error: "Không tìm thấy thành viên trong quỹ" };

  // If refunding, check balance and create refund transaction
  if (refundBalance) {
    const { balance } = await getFundBalance(memberId);
    if (balance > 0) {
      await recordFinancialTransaction({
        memberId,
        type: "fund_refund",
        direction: "out",
        amount: balance,
        description: "Hoàn quỹ khi rời nhóm",
      });
    }
  }

  await db
    .update(fundMembers)
    .set({ isActive: false, leftAt: new Date().toISOString() })
    .where(eq(fundMembers.id, fm.id));

  revalidatePath("/admin/fund");
  revalidatePath("/my-fund");
  return { success: true };
}

// ─── Fund Contributions ───

export async function recordContribution(
  memberId: number,
  amount: number,
  description?: string,
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  if (amount <= 0) return { error: "Số tiền phải lớn hơn 0" };
  if (!Number.isInteger(amount))
    return { error: "Số tiền phải là số nguyên (VND)" };

  const fm = await db.query.fundMembers.findFirst({
    where: and(
      eq(fundMembers.memberId, memberId),
      eq(fundMembers.isActive, true),
    ),
  });
  if (!fm) return { error: "Thành viên không trong quỹ" };

  await recordFinancialTransaction({
    memberId,
    type: "fund_contribution",
    direction: "in",
    amount,
    description: description || "Đóng quỹ",
  });

  revalidatePath("/admin/fund");
  revalidatePath("/my-fund");
  return { success: true };
}

export async function recordRefund(
  memberId: number,
  amount: number,
  description?: string,
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  if (amount <= 0) return { error: "Số tiền phải lớn hơn 0" };
  if (!Number.isInteger(amount))
    return { error: "Số tiền phải là số nguyên (VND)" };

  const { balance } = await getFundBalance(memberId);
  if (amount > balance)
    return { error: `Số dư không đủ (hiện có: ${formatVND(balance)})` };

  await recordFinancialTransaction({
    memberId,
    type: "fund_refund",
    direction: "out",
    amount,
    description: description || "Hoàn quỹ",
  });

  revalidatePath("/admin/fund");
  revalidatePath("/my-fund");
  return { success: true };
}

// ─── Queries ───

export async function getFundMembers() {
  return db.query.fundMembers.findMany({
    with: { member: true },
    orderBy: [desc(fundMembers.joinedAt)],
  });
}

export async function getFundMembersWithBalances() {
  const fms = await db.query.fundMembers.findMany({
    where: eq(fundMembers.isActive, true),
    with: { member: true },
  });

  const result = [];
  for (const fm of fms) {
    const balance = await getFundBalance(fm.memberId);
    result.push({ ...fm, balance });
  }

  return result.sort((a, b) => b.balance.balance - a.balance.balance);
}

export async function getFundTransactionsForMember(memberId: number) {
  const rows = await db.query.financialTransactions.findMany({
    where: and(
      eq(financialTransactions.memberId, memberId),
      inArray(financialTransactions.type, FUND_TRANSACTION_TYPES),
    ),
    with: { session: true },
    orderBy: [desc(financialTransactions.createdAt)],
  });

  return rows.map((tx) => ({ ...tx, type: tx.type as FundTransactionType }));
}

export async function getAllFundTransactions() {
  const rows = await db.query.financialTransactions.findMany({
    where: inArray(financialTransactions.type, FUND_TRANSACTION_TYPES),
    with: { member: true, session: true },
    orderBy: [desc(financialTransactions.createdAt)],
  });

  return rows
    .filter((tx) => tx.memberId !== null && tx.member !== null)
    .map((tx) => ({
      ...tx,
      memberId: tx.memberId as number,
      type: tx.type as FundTransactionType,
      member: tx.member!,
    }));
}

export async function getFundOverview() {
  const balances = await getAllFundBalances();
  const totalBalance = balances.reduce((sum, b) => sum + b.balance, 0);
  const totalContributions = balances.reduce(
    (sum, b) => sum + b.totalContributions,
    0,
  );
  const totalDeductions = balances.reduce(
    (sum, b) => sum + b.totalDeductions,
    0,
  );
  const totalRefunds = balances.reduce((sum, b) => sum + b.totalRefunds, 0);
  const memberCount = balances.length;

  return {
    totalBalance,
    totalContributions,
    totalDeductions,
    totalRefunds,
    memberCount,
    balances,
  };
}

// ─── Update member bank account ───

export async function updateMemberBankAccount(
  memberId: number,
  bankAccountNo: string,
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const trimmed = bankAccountNo.trim();
  if (trimmed && !/^\d{6,20}$/.test(trimmed)) {
    return { error: "Số tài khoản không hợp lệ (chỉ chứa số, 6-20 ký tự)" };
  }

  await db
    .update(members)
    .set({ bankAccountNo: trimmed || null })
    .where(eq(members.id, memberId));

  revalidatePath("/admin/members");
  revalidatePath("/admin/fund");
  return { success: true };
}

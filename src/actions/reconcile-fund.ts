"use server";

import { db } from "@/db";
import {
  financialTransactions,
  fundMembers,
  paymentNotifications,
  sessionDebts,
} from "@/db/schema";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { computeBalanceFromTransactions } from "@/lib/fund-core";

export interface ReconcileIssue {
  severity: "warn" | "error";
  code: string;
  message: string;
}

export interface ReconcileReport {
  ok: boolean;
  generatedAt: string;
  totals: {
    totalIn: number;
    totalOut: number;
    totalRefund: number;
    netInternal: number;
    sumPositiveBalances: number;
    sumNegativeBalances: number;
    netByMembers: number;
  };
  paymentNotifications: {
    matched: number;
    pending: number;
    matchedWithoutTx: number;
    txReferencingMissingNotif: number;
  };
  debtLedger: {
    /** Debt-scoped txs whose debtId no longer points to a real row. */
    orphanDebtRefs: number;
    /** Debts that received a bank_payment_received but flags weren't set. */
    bankPaidWithoutFlags: number;
    /** Reversal txs (reversalOfId set) where the original is missing. */
    orphanReversals: number;
  };
  issues: ReconcileIssue[];
}

/**
 * Reconciliation pass — checks invariants on the financial ledger and reports
 * any drift. Read-only; safe to call any time.
 *
 * Invariants checked:
 *   I1. Σ(direction=in) − Σ(direction=out) − Σ(refund) = Σ(per-member balance)
 *       for fund-related types (contribution / deduction / refund).
 *   I2. Σ(positive balances) + Σ(negative balances) = total fund balance.
 *   I3. Every paymentNotifications row with status='matched' has a linked
 *       financialTransaction row.
 *   I4. Every financialTransaction with paymentNotificationId references a
 *       row that still exists.
 *   I5. No financial transaction has negative or non-integer amount.
 *   I6. No two transactions share the same (non-null) idempotency_key
 *       (DB UNIQUE catches this; double-checked here for visibility).
 *   I7. Every debt-scoped tx (bank_payment_received / debt_member_confirmed /
 *       debt_admin_confirmed / debt_undo) references a sessionDebts row that
 *       still exists. Catches orphan ledger rows after a debt was hard-deleted.
 *   I8. For any debt that has a `bank_payment_received` tx, the parent
 *       sessionDebts row MUST be both memberConfirmed AND adminConfirmed
 *       (after the matcher hardening). Catches partial side-effects.
 *   I9. Every `fund_contribution` with `reversalOfId` must point at an
 *       existing `fund_deduction`. Catches orphan reversals after a
 *       deleteSession.
 */
export async function reconcileFund(): Promise<ReconcileReport> {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return {
      ok: false,
      generatedAt: new Date().toISOString(),
      totals: emptyTotals(),
      paymentNotifications: emptyPnReport(),
      debtLedger: emptyDebtLedger(),
      issues: [
        { severity: "error", code: "auth", message: "Yêu cầu quyền admin" },
      ],
    };
  }

  const issues: ReconcileIssue[] = [];

  const [allFundTxs, fmRows, allNotifs, txWithNotif] = await Promise.all([
    db.query.financialTransactions.findMany({
      where: (t, { inArray }) =>
        inArray(t.type, ["fund_contribution", "fund_deduction", "fund_refund"]),
      columns: {
        id: true,
        type: true,
        direction: true,
        amount: true,
        memberId: true,
        idempotencyKey: true,
        paymentNotificationId: true,
      },
    }),
    db.query.fundMembers.findMany({
      where: eq(fundMembers.isActive, true),
      columns: { memberId: true },
    }),
    db.query.paymentNotifications.findMany({
      columns: { id: true, status: true, matchedTransactionId: true },
    }),
    db.query.financialTransactions.findMany({
      where: (t, { isNotNull }) => isNotNull(t.paymentNotificationId),
      columns: { id: true, paymentNotificationId: true },
    }),
  ]);

  // I5: amount sanity check.
  for (const tx of allFundTxs) {
    if (!Number.isInteger(tx.amount) || tx.amount < 0) {
      issues.push({
        severity: "error",
        code: "I5_invalid_amount",
        message: `Tx #${tx.id} amount=${tx.amount} không hợp lệ`,
      });
    }
  }

  // I1: aggregate sums
  let totalIn = 0;
  let totalOut = 0;
  let totalRefund = 0;
  for (const tx of allFundTxs) {
    if (tx.type === "fund_contribution") totalIn += tx.amount;
    else if (tx.type === "fund_deduction") totalOut += tx.amount;
    else if (tx.type === "fund_refund") totalRefund += tx.amount;
  }
  const netInternal = totalIn - totalOut - totalRefund;

  // Per-member balances
  const balancesByMember = new Map<number, number>();
  for (const tx of allFundTxs) {
    if (!tx.memberId) continue;
    const arr = balancesByMember.get(tx.memberId) ?? 0;
    if (tx.type === "fund_contribution")
      balancesByMember.set(tx.memberId, arr + tx.amount);
    else if (tx.type === "fund_deduction")
      balancesByMember.set(tx.memberId, arr - tx.amount);
    else if (tx.type === "fund_refund")
      balancesByMember.set(tx.memberId, arr - tx.amount);
  }

  let sumPositive = 0;
  let sumNegative = 0;
  for (const b of balancesByMember.values()) {
    if (b > 0) sumPositive += b;
    else if (b < 0) sumNegative += b;
  }
  const netByMembers = sumPositive + sumNegative;

  if (netInternal !== netByMembers) {
    issues.push({
      severity: "error",
      code: "I1_imbalance",
      message: `Tổng giao dịch (${netInternal}) khác tổng số dư từng member (${netByMembers}). Lệch ${netInternal - netByMembers}đ.`,
    });
  }

  // I3: notifications matched but no linked tx
  const txByNotifId = new Map<number, number>();
  for (const tx of txWithNotif) {
    if (tx.paymentNotificationId)
      txByNotifId.set(tx.paymentNotificationId, tx.id);
  }
  let matchedCount = 0;
  let pendingCount = 0;
  let matchedWithoutTx = 0;
  for (const n of allNotifs) {
    if (n.status === "matched") {
      matchedCount++;
      if (!txByNotifId.has(n.id)) {
        matchedWithoutTx++;
        issues.push({
          severity: "warn",
          code: "I3_matched_without_tx",
          message: `paymentNotifications #${n.id} status=matched nhưng không có financial_transaction tham chiếu`,
        });
      }
    } else if (n.status === "pending") {
      pendingCount++;
    }
  }

  // I4: tx referencing a missing notif id
  const notifIds = new Set(allNotifs.map((n) => n.id));
  let txReferencingMissingNotif = 0;
  for (const tx of txWithNotif) {
    if (tx.paymentNotificationId && !notifIds.has(tx.paymentNotificationId)) {
      txReferencingMissingNotif++;
      issues.push({
        severity: "error",
        code: "I4_missing_notif",
        message: `Tx #${tx.id} tham chiếu paymentNotification #${tx.paymentNotificationId} không tồn tại`,
      });
    }
  }

  // I6: duplicate idempotency keys (DB UNIQUE catches but report visibly).
  const seenKeys = new Map<string, number>();
  for (const tx of allFundTxs) {
    if (!tx.idempotencyKey) continue;
    const prev = seenKeys.get(tx.idempotencyKey);
    if (prev !== undefined) {
      issues.push({
        severity: "error",
        code: "I6_duplicate_idempotency_key",
        message: `idempotencyKey "${tx.idempotencyKey}" xuất hiện ở tx #${prev} và tx #${tx.id}`,
      });
    } else {
      seenKeys.set(tx.idempotencyKey, tx.id);
    }
  }

  // Bonus invariant: every active fund member should resolve via balancesByMember.
  for (const fm of fmRows) {
    if (!balancesByMember.has(fm.memberId)) {
      // Member chưa có giao dịch nào → balance = 0, hợp lệ. Không cần báo.
    }
  }

  // I7 + I8: debt-scoped ledger consistency.
  const debtScopedTxs = await db.query.financialTransactions.findMany({
    where: (t, { isNotNull, inArray: inA }) =>
      and(
        isNotNull(t.debtId),
        inA(t.type, [
          "bank_payment_received",
          "debt_member_confirmed",
          "debt_admin_confirmed",
          "debt_undo",
          "debt_created",
        ]),
      ),
    columns: { id: true, type: true, debtId: true },
  });

  const debtIdSet = new Set<number>();
  for (const t of debtScopedTxs) if (t.debtId) debtIdSet.add(t.debtId);

  let debtRows: Array<{
    id: number;
    memberConfirmed: boolean | null;
    adminConfirmed: boolean | null;
  }> = [];
  if (debtIdSet.size > 0) {
    debtRows = await db.query.sessionDebts.findMany({
      where: inArray(sessionDebts.id, [...debtIdSet]),
      columns: {
        id: true,
        memberConfirmed: true,
        adminConfirmed: true,
      },
    });
  }
  const debtById = new Map(debtRows.map((d) => [d.id, d]));

  let orphanDebtRefs = 0;
  for (const t of debtScopedTxs) {
    if (!t.debtId) continue;
    if (!debtById.has(t.debtId)) {
      orphanDebtRefs++;
      issues.push({
        severity: "warn",
        code: "I7_orphan_debt_ref",
        message: `Tx #${t.id} (${t.type}) trỏ tới debt #${t.debtId} không tồn tại`,
      });
    }
  }

  // I8: a debt with bank_payment_received must be fully confirmed.
  const debtIdsWithBankPayment = new Set(
    debtScopedTxs
      .filter((t) => t.type === "bank_payment_received")
      .map((t) => t.debtId)
      .filter((id): id is number => id !== null),
  );
  let bankPaidWithoutFlags = 0;
  for (const debtId of debtIdsWithBankPayment) {
    const d = debtById.get(debtId);
    if (!d) continue; // already counted as orphan above
    if (!d.memberConfirmed || !d.adminConfirmed) {
      bankPaidWithoutFlags++;
      issues.push({
        severity: "error",
        code: "I8_bank_paid_partial_flags",
        message: `Debt #${debtId} có bank_payment_received nhưng memberConfirmed=${d.memberConfirmed} adminConfirmed=${d.adminConfirmed}`,
      });
    }
  }

  // I9: orphan reversals.
  const reversals = await db.query.financialTransactions.findMany({
    where: (t, { isNotNull }) => isNotNull(t.reversalOfId),
    columns: { id: true, reversalOfId: true },
  });
  const reversedIds = reversals
    .map((r) => r.reversalOfId)
    .filter((x): x is number => x !== null);
  let orphanReversals = 0;
  if (reversedIds.length > 0) {
    const originalRows = await db.query.financialTransactions.findMany({
      where: inArray(financialTransactions.id, reversedIds),
      columns: { id: true },
    });
    const originalIdSet = new Set(originalRows.map((r) => r.id));
    for (const rev of reversals) {
      if (rev.reversalOfId && !originalIdSet.has(rev.reversalOfId)) {
        orphanReversals++;
        issues.push({
          severity: "warn",
          code: "I9_orphan_reversal",
          message: `Tx #${rev.id} reversalOfId=${rev.reversalOfId} không tồn tại`,
        });
      }
    }
  }

  // Cross-check invariant (sanity): recompute one balance via library function
  // and compare — proves computeBalanceFromTransactions matches our aggregate.
  if (fmRows[0]) {
    const sampleId = fmRows[0].memberId;
    const sampleTxs = allFundTxs.filter((t) => t.memberId === sampleId);
    const libBalance = computeBalanceFromTransactions(
      sampleId,
      sampleTxs.map((t) => ({ type: t.type, amount: t.amount })),
    ).balance;
    const aggBalance = balancesByMember.get(sampleId) ?? 0;
    if (libBalance !== aggBalance) {
      issues.push({
        severity: "error",
        code: "lib_vs_agg",
        message: `computeBalanceFromTransactions (${libBalance}) lệch với aggregation (${aggBalance}) cho member ${sampleId}`,
      });
    }
  }

  return {
    ok: issues.filter((i) => i.severity === "error").length === 0,
    generatedAt: new Date().toISOString(),
    totals: {
      totalIn,
      totalOut,
      totalRefund,
      netInternal,
      sumPositiveBalances: sumPositive,
      sumNegativeBalances: sumNegative,
      netByMembers,
    },
    paymentNotifications: {
      matched: matchedCount,
      pending: pendingCount,
      matchedWithoutTx,
      txReferencingMissingNotif,
    },
    debtLedger: {
      orphanDebtRefs,
      bankPaidWithoutFlags,
      orphanReversals,
    },
    issues,
  };
}

function emptyTotals() {
  return {
    totalIn: 0,
    totalOut: 0,
    totalRefund: 0,
    netInternal: 0,
    sumPositiveBalances: 0,
    sumNegativeBalances: 0,
    netByMembers: 0,
  };
}

function emptyPnReport() {
  return {
    matched: 0,
    pending: 0,
    matchedWithoutTx: 0,
    txReferencingMissingNotif: 0,
  };
}

function emptyDebtLedger() {
  return {
    orphanDebtRefs: 0,
    bankPaidWithoutFlags: 0,
    orphanReversals: 0,
  };
}

// Suppress unused-import warning for symbols kept for future use.
void [paymentNotifications, and, isNull];

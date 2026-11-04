"use server";

import { requireAdmin } from "@/lib/auth";
import { db } from "@/db";
import { runReconcile, type ReconcileReport } from "@/lib/reconcile-core";

export type { ReconcileIssue, ReconcileReport } from "@/lib/reconcile-core";

/**
 * Kiểm sổ quỹ cho trang admin: kiểm quyền rồi gọi lõi `runReconcile`
 * (`src/lib/reconcile-core.ts`, nơi giữ các bất biến I1-I10).
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

  return runReconcile(db);
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

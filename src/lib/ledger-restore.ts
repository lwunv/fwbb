/**
 * Shared ledger-restore helper.
 *
 * Extracted from `src/actions/finance.ts` so it can be reused by both the
 * in-app payment-confirm path AND the bank-transfer matcher
 * (`src/lib/payment-matcher.ts`). It takes a live transaction handle (`tx`),
 * which a `"use server"` action export cannot expose, so it lives here as a
 * plain lib function.
 *
 * WHY it exists: in the merged Quỹ+Nợ model, `finalizeSession` writes a
 * `fund_deduction` per debt. `undoPaymentByAdmin` REVERSES that deduction (so
 * the member is made whole). If the member then pays — whether by tapping
 * "confirm" in-app OR via a real bank transfer — the confirm/matcher flow adds
 * a balance-fix `fund_contribution` (+amount). Without re-inserting the voided
 * deduction first, that +contribution has nothing to cancel and the member is
 * gifted a free session. This helper re-charges the deduction when (and only
 * when) the debt came back from an undo.
 */

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { financialTransactions } from "@/db/schema";
import { recordFinancialTransaction } from "@/lib/financial-ledger";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * If `debtId` has no LIVE `fund_deduction` (i.e. it was reversed by an undo),
 * re-insert a fresh deduction for the amount of the most-recently-voided
 * original, plus restore any voided admin min-deduction penalty contribution.
 * No-op when a live deduction already exists (normal, non-undone debt).
 *
 * Must be called inside a `db.transaction`. Throws on ledger error so the
 * caller's transaction rolls back.
 */
export async function restoreVoidedLedgerForDebt(
  tx: Tx,
  debtId: number,
  debt: { memberId: number; sessionId: number; totalAmount: number },
  sessionDate: string,
): Promise<void> {
  // 1. Member fund_deduction restoration.
  //    Are there any LIVE deductions for this debt? Live = original
  //    (reversalOfId IS NULL) that is NOT pointed at by any other row's
  //    reversalOfId. Use isNull(reversalOfId) to limit to originals first.
  const debtDeductions = await tx.query.financialTransactions.findMany({
    where: and(
      eq(financialTransactions.debtId, debtId),
      eq(financialTransactions.type, "fund_deduction"),
      isNull(financialTransactions.reversalOfId),
    ),
  });

  let liveMemberDeductionExists = false;
  let cycleSeed = 0; // most-recent voided original id → makes idempotency key unique per cycle
  let restoreAmount = 0; // amount of THAT voided deduction — re-charge EXACTLY this
  for (const d of debtDeductions) {
    const reversal = await tx.query.financialTransactions.findFirst({
      where: eq(financialTransactions.reversalOfId, d.id),
      columns: { id: true },
    });
    if (!reversal) {
      liveMemberDeductionExists = true;
    } else if (d.id >= cycleSeed) {
      cycleSeed = d.id; // most-recent voided id seeds the key
      restoreAmount = d.amount; // ...và amount gốc của nó
    }
  }

  if (!liveMemberDeductionExists && restoreAmount > 0) {
    // No live deduction → debt was undone. Re-insert a fresh deduction so the
    // member is charged again. Dùng `restoreAmount` = amount của deduction GỐC
    // (đã bị void), KHÔNG phải debt.totalAmount — debt của admin gồm cả phần
    // khách (quỹ chung gánh) nên totalAmount > deduction thật (chỉ play+dine);
    // dùng total sẽ over-charge admin. cycleSeed làm key unique mỗi cycle.
    const r = await recordFinancialTransaction(
      {
        type: "fund_deduction",
        direction: "out",
        amount: restoreAmount,
        memberId: debt.memberId,
        sessionId: debt.sessionId,
        debtId,
        description: `Trừ quỹ buổi ${sessionDate} (re-confirm sau undo)`,
        idempotencyKey: `re-confirm-deduction-${debtId}-${cycleSeed}`,
      },
      tx,
    );
    if ("error" in r) throw new Error(r.error);
  }

  // 2. Admin min-deduction penalty restoration.
  //    Admin penalty contributions are tagged with debtId=insertedDebt.id and
  //    type=fund_contribution. After undo, the row exists but is voided by a
  //    `fund_refund` (with reversalOfId pointing at it). If we find such a
  //    voided contribution whose memberId differs from debt.memberId (i.e.
  //    belongs to admin, not the debt owner), re-insert it so admin's penalty
  //    surplus is restored.
  const debtContribs = await tx.query.financialTransactions.findMany({
    where: and(
      eq(financialTransactions.debtId, debtId),
      eq(financialTransactions.type, "fund_contribution"),
      isNull(financialTransactions.reversalOfId),
    ),
  });

  for (const c of debtContribs) {
    if (c.memberId === debt.memberId) continue; // not a penalty row (skip bank balance-fix etc. tied to member themselves)
    if (c.memberId === null) continue;
    const reversal = await tx.query.financialTransactions.findFirst({
      where: eq(financialTransactions.reversalOfId, c.id),
      columns: { id: true },
    });
    if (!reversal) continue; // still live, no need to restore

    // idempotencyKey `re-confirm-penalty-${c.id}` is unique per voided
    // original — recordFinancialTransaction's idempotent path returns the
    // existing row id on replay, so re-running this confirm-then-undo-then-
    // confirm cycle won't duplicate the penalty. Each fresh undo→confirm
    // cycle voids a NEW row (the previously-restored one) → new c.id → new
    // key, so the next restore is allowed.
    const r = await recordFinancialTransaction(
      {
        type: "fund_contribution",
        direction: "in",
        amount: c.amount,
        memberId: c.memberId,
        sessionId: c.sessionId,
        debtId,
        description: `Khôi phục phụ phí buổi ${sessionDate} (re-confirm sau undo)`,
        idempotencyKey: `re-confirm-penalty-${c.id}`,
      },
      tx,
    );
    if ("error" in r) throw new Error(r.error);
  }
}

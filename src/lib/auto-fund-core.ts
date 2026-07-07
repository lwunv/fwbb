import { db } from "@/db";
import { sessionDebts, financialTransactions } from "@/db/schema";
import { eq, and, asc, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { isFundMember } from "@/lib/fund-calculator";
import { computeBalanceFromTransactions } from "@/lib/fund-core";
import { recordFinancialTransaction } from "@/lib/financial-ledger";

export interface AutoApplyResult {
  appliedCount: number;
  appliedTotal: number;
  remainingBalance: number;
  /** Set when the tx threw mid-loop — caller must surface to user. */
  error?: string;
}

/**
 * Tự động trừ quỹ thanh toán các khoản nợ chưa trả của member.
 * Áp dụng oldest-first: đi từ debt có id nhỏ nhất, deduct full nếu balance đủ,
 * stop khi balance không đủ trả debt kế tiếp (không partial vì DB không track paidAmount).
 *
 * Idempotent: chỉ confirm các debt unpaid (memberConfirmed=false AND adminConfirmed=false).
 * Mỗi lần gọi sẽ tự dừng khi không còn debt unpaid hoặc balance không đủ.
 *
 * SECURITY: đây là internal helper, KHÔNG phải server action. Trước đây nó được
 * export từ một file `"use server"` → trở thành RPC endpoint công khai không gate,
 * cho phép kẻ tấn công vô danh ép trừ quỹ của bất kỳ memberId nào. Giờ nằm ở
 * src/lib/ và chỉ được gọi bởi các flow ĐÃ xác thực (recordContribution /
 * confirmFundClaim / reverseFinancialTransaction — đều requireAdmin — và
 * payment-matcher webhook đã verify OIDC). memberId luôn do server cung cấp.
 */
export async function autoApplyFundToDebts(
  memberId: number,
): Promise<AutoApplyResult> {
  const inFund = await isFundMember(memberId);
  if (!inFund) {
    return { appliedCount: 0, appliedTotal: 0, remainingBalance: 0 };
  }

  let appliedCount = 0;
  let appliedTotal = 0;
  let finalBalance = 0;
  const now = new Date().toISOString();

  try {
    await db.transaction(async (tx) => {
      // Đọc balance INSIDE transaction (AGENTS.md rule: race-condition nếu
      // đọc balance outside rồi write inside — 2 autoApply concurrent đều
      // thấy stale balance → over-deduct).
      const txs = await tx.query.financialTransactions.findMany({
        where: eq(financialTransactions.memberId, memberId),
      });
      const initial = computeBalanceFromTransactions(memberId, txs);
      let balance = initial.balance;
      finalBalance = balance;

      if (balance <= 0) return;

      const unpaid = await tx.query.sessionDebts.findMany({
        where: and(
          eq(sessionDebts.memberId, memberId),
          eq(sessionDebts.memberConfirmed, false),
          eq(sessionDebts.adminConfirmed, false),
        ),
        orderBy: [asc(sessionDebts.id)],
        columns: { id: true, totalAmount: true, sessionId: true },
      });
      if (unpaid.length === 0) return;

      for (const debt of unpaid) {
        if (balance < debt.totalAmount) break;

        // Cycle-fresh idempotency key. After an undo the previous
        // `auto-apply-debt-<id>` deduction persists as a VOIDED row (its key
        // still occupies the UNIQUE index). A static key would make the next
        // apply replay as a no-op — marking the debt paid WITHOUT deducting the
        // fund (silent free session). Seed the key with the most-recent voided
        // deduction id for this debt so each re-apply inserts a real row, and
        // skip entirely if a LIVE deduction already exists (never double-charge
        // an inconsistent flags=false state). Mirrors restoreVoidedLedgerForDebt.
        const priorDeductions = await tx.query.financialTransactions.findMany({
          where: and(
            eq(financialTransactions.debtId, debt.id),
            eq(financialTransactions.type, "fund_deduction"),
            isNull(financialTransactions.reversalOfId),
          ),
          columns: { id: true },
        });
        let liveDeductionExists = false;
        let cycleSeed = 0;
        for (const d of priorDeductions) {
          const reversal = await tx.query.financialTransactions.findFirst({
            where: eq(financialTransactions.reversalOfId, d.id),
            columns: { id: true },
          });
          if (!reversal) liveDeductionExists = true;
          else if (d.id > cycleSeed) cycleSeed = d.id;
        }
        if (liveDeductionExists) continue;

        // Write the balancing ledger entry FIRST, then flip the confirmed flags
        // only after it actually persisted — never mark a debt paid without a
        // deduction (invariant I8).
        const r = await recordFinancialTransaction(
          {
            type: "fund_deduction",
            direction: "out",
            amount: debt.totalAmount,
            memberId,
            sessionId: debt.sessionId,
            debtId: debt.id,
            description: `Auto trừ quỹ — debt #${debt.id}`,
            metadata: { autoApplied: true },
            idempotencyKey: `auto-apply-debt-${debt.id}-${cycleSeed}`,
          },
          tx,
        );
        if ("error" in r) throw new Error(r.error);

        await tx
          .update(sessionDebts)
          .set({
            memberConfirmed: true,
            memberConfirmedAt: now,
            adminConfirmed: true,
            adminConfirmedAt: now,
          })
          .where(eq(sessionDebts.id, debt.id));

        balance -= debt.totalAmount;
        appliedTotal += debt.totalAmount;
        appliedCount++;
      }
      finalBalance = balance;
    });
  } catch (err) {
    // AGENTS.md rule #8: never silently swallow errors in financial flows.
    // The tx rolled back so no money moved, but the caller must know auto-apply
    // failed so it can show a toast and skip declaring "đã trừ quỹ thành công"
    // when nothing actually applied.
    const message = err instanceof Error ? err.message : String(err);
    console.error("[auto-fund] applyToDebts failed", {
      memberId,
      error: message,
    });
    return {
      appliedCount: 0,
      appliedTotal: 0,
      remainingBalance: 0,
      error: `Auto-trừ quỹ thất bại: ${message}`,
    };
  }

  if (appliedCount > 0) {
    revalidatePath("/");
    revalidatePath("/my-debts");
    revalidatePath("/my-fund");
    revalidatePath("/admin/finance");
    revalidatePath("/admin/fund");
  }

  return { appliedCount, appliedTotal, remainingBalance: finalBalance };
}

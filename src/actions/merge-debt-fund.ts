"use server";

import { db } from "@/db";
import { sessionDebts, sessions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { recordFinancialTransaction } from "@/lib/financial-ledger";
import { requireAdmin } from "@/lib/auth";

/**
 * Idempotent one-shot migration: collapse the legacy per-session debt model
 * into the unified fund balance.
 *
 * For each `sessionDebts` row that is NOT yet admin-confirmed:
 *  1. Auto-enroll member into fund (if missing).
 *  2. Insert a `fund_deduction` of the full outstanding amount, tied to the
 *     session — this pulls the member's fund balance down, which is now the
 *     single source of truth for "còn nợ".
 *  3. Mark the debt row as fully confirmed so it never appears as outstanding
 *     in legacy queries.
 *
 * Safe to call repeatedly — does nothing once all debts have been migrated.
 *
 * SECURITY: admin-only. Was previously callable unauth, which let any visitor
 * trigger ledger writes against any member's debts.
 */
export async function mergeLegacyDebtsIntoFund(): Promise<
  | {
      migratedCount: number;
      totalAmount: number;
      /**
       * Debts that were `memberConfirmed=true, adminConfirmed=false` before
       * this migration. The member claimed they paid via QR/cash but no
       * matching contribution exists. Migration marked them as deducted from
       * the fund anyway; if the money DID arrive (in-person cash, off-ledger),
       * admin needs to backfill a `recordContribution` for these members.
       * Surfaced here so the UI can show a reconciliation queue instead of
       * silently double-charging.
       */
      needsManualBackfill: Array<{
        debtId: number;
        memberId: number;
        sessionId: number;
        amount: number;
      }>;
    }
  | { error: string }
> {
  const auth = await requireAdmin();
  if ("error" in auth) return { error: auth.error };

  const unpaid = await db.query.sessionDebts.findMany({
    where: and(
      eq(sessionDebts.adminConfirmed, false),
      eq(sessionDebts.memberConfirmed, false),
    ),
    with: { session: { columns: { date: true } } },
    columns: {
      id: true,
      memberId: true,
      sessionId: true,
      totalAmount: true,
    },
  });

  const memberClaimed = await db.query.sessionDebts.findMany({
    where: and(
      eq(sessionDebts.memberConfirmed, true),
      eq(sessionDebts.adminConfirmed, false),
    ),
    columns: {
      id: true,
      memberId: true,
      sessionId: true,
      totalAmount: true,
    },
  });

  if (unpaid.length === 0 && memberClaimed.length === 0) {
    return { migratedCount: 0, totalAmount: 0, needsManualBackfill: [] };
  }

  const now = new Date().toISOString();
  const needsManualBackfill: Array<{
    debtId: number;
    memberId: number;
    sessionId: number;
    amount: number;
  }> = [];

  // Wrap the entire migration in a single transaction. Previously each debt
  // ran in its own tx — if iteration N succeeded but N+1 failed, the system
  // was left half-migrated until a manual retry. With one tx, the migration
  // is all-or-nothing; partial failures roll back to the pre-migration
  // state so admin can investigate without a half-broken ledger.
  let migratedCount = 0;
  let totalAmount = 0;

  try {
    await db.transaction(async (tx) => {
      for (const debt of unpaid) {
        if (debt.totalAmount <= 0) continue;

        const sessionDate = (
          await tx.query.sessions.findFirst({
            where: eq(sessions.id, debt.sessionId),
            columns: { date: true },
          })
        )?.date;

        const r = await recordFinancialTransaction(
          {
            type: "fund_deduction",
            direction: "out",
            amount: debt.totalAmount,
            memberId: debt.memberId,
            sessionId: debt.sessionId,
            debtId: debt.id,
            description: `Chuyển công nợ buổi ${sessionDate ?? "?"} sang quỹ`,
            metadata: { migratedFromDebt: true },
            idempotencyKey: `merge-legacy-debt-${debt.id}`,
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

        migratedCount++;
        totalAmount += debt.totalAmount;
      }

      // Member-confirmed-but-not-admin-confirmed debts: member said they
      // paid but no matching contribution exists. Migration deducts from
      // fund (so balance reflects truth-as-recorded), but the debt is
      // surfaced via `needsManualBackfill` so admin can verify off-ledger
      // and credit a contribution if needed. Without surfacing, member
      // pays twice.
      for (const debt of memberClaimed) {
        if (debt.totalAmount <= 0) continue;

        const r = await recordFinancialTransaction(
          {
            type: "fund_deduction",
            direction: "out",
            amount: debt.totalAmount,
            memberId: debt.memberId,
            sessionId: debt.sessionId,
            debtId: debt.id,
            description: `Chuyển công nợ buổi (chờ admin xác nhận) sang quỹ`,
            metadata: { migratedFromDebt: true, wasMemberClaimed: true },
            idempotencyKey: `merge-legacy-claim-${debt.id}`,
          },
          tx,
        );
        if ("error" in r) throw new Error(r.error);

        await tx
          .update(sessionDebts)
          .set({
            adminConfirmed: true,
            adminConfirmedAt: now,
          })
          .where(eq(sessionDebts.id, debt.id));

        needsManualBackfill.push({
          debtId: debt.id,
          memberId: debt.memberId,
          sessionId: debt.sessionId,
          amount: debt.totalAmount,
        });

        migratedCount++;
        totalAmount += debt.totalAmount;
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[mergeLegacyDebtsIntoFund] failed", { error: msg });
    return { error: `Migration failed mid-run, rolled back: ${msg}` };
  }

  if (needsManualBackfill.length > 0) {
    console.warn(
      "[mergeLegacyDebtsIntoFund] member-claimed debts deducted from fund — admin must verify off-ledger payments and backfill contributions if money actually arrived",
      { count: needsManualBackfill.length, items: needsManualBackfill },
    );
  }

  return { migratedCount, totalAmount, needsManualBackfill };
}

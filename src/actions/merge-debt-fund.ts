"use server";

import { db } from "@/db";
import { sessionDebts, fundMembers, sessions } from "@/db/schema";
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
  { migratedCount: number; totalAmount: number } | { error: string }
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

  if (unpaid.length === 0) return { migratedCount: 0, totalAmount: 0 };

  let migratedCount = 0;
  let totalAmount = 0;
  const now = new Date().toISOString();

  for (const debt of unpaid) {
    if (debt.totalAmount <= 0) continue;

    await db.transaction(async (tx) => {
      await tx
        .insert(fundMembers)
        .values({ memberId: debt.memberId, isActive: true, joinedAt: now })
        .onConflictDoNothing();

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
          // Natural key per debt — if the loop crashes mid-way and is
          // retried (page reload), the second pass re-fetches the same
          // debts (still memberConfirmed=false until the UPDATE below
          // commits). Without this key, a retry between the insert and
          // the flag-flip would double-deduct the member's fund.
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
    });

    migratedCount++;
    totalAmount += debt.totalAmount;
  }

  // Member-confirmed-but-not-admin-confirmed debts are also collapsed: the
  // member said they paid via QR/cash, but the money never actually landed in
  // the fund. After merge, those become fund_deduction with metadata flag so
  // admin can manually backfill a contribution if money did arrive.
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

  for (const debt of memberClaimed) {
    if (debt.totalAmount <= 0) continue;
    await db.transaction(async (tx) => {
      await tx
        .insert(fundMembers)
        .values({ memberId: debt.memberId, isActive: true, joinedAt: now })
        .onConflictDoNothing();

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
          // Same idempotency rationale as the first loop: prevents
          // double-deduct on retry.
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
    });

    migratedCount++;
    totalAmount += debt.totalAmount;
  }

  return { migratedCount, totalAmount };
}

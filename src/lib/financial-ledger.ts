import { db } from "@/db";
import { financialTransactions } from "@/db/schema";
import { eq } from "drizzle-orm";

type DbLike = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type FinancialTransactionType =
  | "fund_contribution"
  | "fund_deduction"
  | "fund_refund"
  | "debt_created"
  | "debt_member_confirmed"
  | "debt_admin_confirmed"
  | "debt_undo"
  | "inventory_purchase"
  | "manual_adjustment"
  | "bank_payment_received";

export type FinancialTransactionDirection = "in" | "out" | "neutral";

export interface RecordFinancialTransactionInput {
  type: FinancialTransactionType;
  direction: FinancialTransactionDirection;
  amount: number;
  memberId?: number | null;
  sessionId?: number | null;
  debtId?: number | null;
  paymentNotificationId?: number | null;
  inventoryPurchaseId?: number | null;
  reversalOfId?: number | null;
  description?: string | null;
  metadata?: Record<string, string | number | boolean | null> | null;
  /**
   * Optional idempotency key — caller (server action) generates a stable UUID
   * per logical action. Replaying the same call returns the original row id
   * instead of inserting a duplicate. Persisted with the row so a later DB
   * UNIQUE constraint catches any race that slips past the read check.
   */
  idempotencyKey?: string | null;
}

export async function recordFinancialTransaction(
  input: RecordFinancialTransactionInput,
  tx: DbLike = db,
) {
  if (!Number.isInteger(input.amount) || input.amount < 0) {
    return { error: "Số tiền giao dịch phải là số nguyên không âm" };
  }

  // Idempotent path: if a row with the same key already exists, return its id
  // and do nothing. The DB UNIQUE INDEX on idempotency_key WHERE NOT NULL is
  // the last line of defence (catches concurrent inserts with the same key).
  if (input.idempotencyKey) {
    const existing = await tx.query.financialTransactions.findFirst({
      where: eq(financialTransactions.idempotencyKey, input.idempotencyKey),
      columns: { id: true },
    });
    if (existing) {
      return { success: true as const, id: existing.id, replayed: true };
    }
  }

  try {
    const [transaction] = await tx
      .insert(financialTransactions)
      .values({
        type: input.type,
        direction: input.direction,
        amount: input.amount,
        memberId: input.memberId ?? null,
        sessionId: input.sessionId ?? null,
        debtId: input.debtId ?? null,
        paymentNotificationId: input.paymentNotificationId ?? null,
        inventoryPurchaseId: input.inventoryPurchaseId ?? null,
        reversalOfId: input.reversalOfId ?? null,
        description: input.description ?? null,
        metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
        idempotencyKey: input.idempotencyKey ?? null,
      })
      .returning({ id: financialTransactions.id });

    return { success: true as const, id: transaction.id };
  } catch (err) {
    // Concurrent insert with the same key → DB UNIQUE catches it; reload and
    // return the winner's id so the caller still sees an idempotent result.
    if (input.idempotencyKey) {
      const winner = await tx.query.financialTransactions.findFirst({
        where: eq(financialTransactions.idempotencyKey, input.idempotencyKey),
        columns: { id: true },
      });
      if (winner)
        return { success: true as const, id: winner.id, replayed: true };
    }
    return {
      error:
        "Không ghi được giao dịch: " +
        (err instanceof Error ? err.message : "lỗi không xác định"),
    };
  }
}

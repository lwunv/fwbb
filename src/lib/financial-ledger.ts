import { db } from "@/db";
import { financialTransactions } from "@/db/schema";

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
}

export async function recordFinancialTransaction(
  input: RecordFinancialTransactionInput,
  tx: DbLike = db,
) {
  if (!Number.isInteger(input.amount) || input.amount < 0) {
    return { error: "Số tiền giao dịch phải là số nguyên không âm" };
  }

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
    })
    .returning({ id: financialTransactions.id });

  return { success: true, id: transaction.id };
}

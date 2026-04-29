"use server";

import { db } from "@/db";
import { financialTransactions, paymentNotifications } from "@/db/schema";
import { desc, inArray } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";

export interface BankTxRow {
  id: number;
  amount: number;
  memo: string | null;
  senderBank: string | null;
  senderAccountNo: string | null;
  status: "pending" | "matched" | "ignored" | "failed";
  matchedDebtId: number | null;
  receivedAt: string;
  /** kết quả parse memo memberId nếu có */
  memberId: number | null;
  memberName: string | null;
}

export interface SystemTxRow {
  id: number;
  type:
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
  direction: "in" | "out" | "neutral";
  amount: number;
  memberId: number | null;
  memberName: string | null;
  sessionId: number | null;
  sessionDate: string | null;
  debtId: number | null;
  description: string | null;
  createdAt: string;
}

/**
 * Tab "Auto" — các giao dịch ngân hàng hệ thống nhận qua Gmail Pub/Sub.
 * Lấy từ payment_notifications, exclude `senderBank=manual` (manual claim từ user).
 */
export async function getBankTransactions(limit = 100): Promise<BankTxRow[]> {
  const auth = await requireAdmin();
  if ("error" in auth) return [];

  const rows = await db
    .select()
    .from(paymentNotifications)
    .orderBy(desc(paymentNotifications.receivedAt))
    .limit(limit);

  // Filter out manual claims (those are user-initiated, not bank-detected)
  const bankRows = rows.filter((r) => r.senderBank !== "manual");

  // Hydrate memberName from memo "FWBB QUY {id}" or "FWBB NO {id}"
  const memberIds = new Set<number>();
  const parsed: { row: (typeof bankRows)[number]; memberId: number | null }[] =
    [];
  for (const r of bankRows) {
    const memo = (r.transferContent ?? "").toUpperCase();
    const m = memo.match(/QUY\s+(\d{1,5})/) || memo.match(/NO\s+(\d{1,5})/);
    const memberId = m ? parseInt(m[1], 10) : null;
    if (memberId !== null) memberIds.add(memberId);
    parsed.push({ row: r, memberId });
  }

  let memberMap = new Map<number, string>();
  if (memberIds.size > 0) {
    const { members } = await import("@/db/schema");
    const ms = await db.query.members.findMany({
      where: inArray(members.id, Array.from(memberIds)),
      columns: { id: true, name: true },
    });
    memberMap = new Map(ms.map((m) => [m.id, m.name]));
  }

  return parsed.map(({ row, memberId }) => ({
    id: row.id,
    amount: row.amount ?? 0,
    memo: row.transferContent,
    senderBank: row.senderBank,
    senderAccountNo: row.senderAccountNo,
    status: (row.status ?? "pending") as BankTxRow["status"],
    matchedDebtId: row.matchedDebtId,
    receivedAt: row.receivedAt ?? "",
    memberId,
    memberName: memberId !== null ? (memberMap.get(memberId) ?? null) : null,
  }));
}

/**
 * Tab "System" — các giao dịch nội bộ: trừ quỹ, trả nợ (admin xác nhận hay auto).
 * Lấy từ financial_transactions: fund_deduction, fund_refund, debt_*, bank_payment_received.
 */
export async function getSystemTransactions(
  limit = 200,
): Promise<SystemTxRow[]> {
  const auth = await requireAdmin();
  if ("error" in auth) return [];

  const includeTypes = [
    "fund_deduction",
    "fund_refund",
    "fund_contribution",
    "bank_payment_received",
    "debt_created",
    "debt_member_confirmed",
    "debt_admin_confirmed",
    "debt_undo",
    "manual_adjustment",
  ] as const;

  const rows = await db.query.financialTransactions.findMany({
    where: inArray(financialTransactions.type, [...includeTypes]),
    with: { member: true, session: true },
    orderBy: [desc(financialTransactions.createdAt)],
    limit,
  });

  return rows.map((r) => ({
    id: r.id,
    type: r.type as SystemTxRow["type"],
    direction: r.direction as SystemTxRow["direction"],
    amount: r.amount,
    memberId: r.memberId,
    memberName: r.member?.name ?? null,
    sessionId: r.sessionId,
    sessionDate: r.session?.date ?? null,
    debtId: r.debtId,
    description: r.description,
    createdAt: r.createdAt ?? "",
  }));
}

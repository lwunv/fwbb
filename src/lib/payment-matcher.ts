/**
 * Payment matcher — matches incoming bank transfers to FWBB debts or fund contributions.
 *
 * Match priority:
 * 1. Memo intent (fund keyword → contribution, session date/id → debt)
 * 2. Sender account number → member lookup → oldest unpaid debt
 * 3. No match → log as "pending" for admin manual review
 *
 * Idempotency: payment_notifications.gmail_message_id has a UNIQUE constraint;
 * we INSERT-first with `onConflictDoNothing` so two concurrent invocations for
 * the same Gmail message can't both pass the check-then-insert race.
 */

import { db } from "@/db";
import { members, sessionDebts, paymentNotifications } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { parseMemoIntent, type ParsedTimoPayment } from "./timo-parser";
import { isFundMember } from "./fund-calculator";
import { recordFinancialTransaction } from "./financial-ledger";
import { formatVND } from "./utils";

export interface MatchResult {
  status: "matched_debt" | "matched_fund" | "pending" | "duplicate";
  debtId?: number;
  transactionId?: number;
  memberId?: number;
  message: string;
}

export async function processPayment(
  payment: ParsedTimoPayment,
  gmailMessageId: string,
): Promise<MatchResult> {
  // 1. Race-safe idempotency: claim the gmailMessageId by inserting up-front.
  //    If another invocation already claimed it, the insert returns no row.
  const claimed = await db
    .insert(paymentNotifications)
    .values({
      gmailMessageId,
      senderBank: "timo",
      amount: payment.amount,
      transferContent: payment.memo,
      senderAccountNo: payment.senderAccountNo,
      status: "pending",
      rawSnippet: `${payment.transId} | ${payment.memo}`.slice(0, 500),
    })
    .onConflictDoNothing({ target: paymentNotifications.gmailMessageId })
    .returning({ id: paymentNotifications.id });

  if (claimed.length === 0) {
    return { status: "duplicate", message: "Đã xử lý trước đó" };
  }
  const notificationId = claimed[0].id;

  // 2. Parse memo intent
  const intent = parseMemoIntent(payment.memo);

  // 3. Try to find member by sender account number
  let matchedMember: { id: number; name: string } | null = null;
  if (payment.senderAccountNo) {
    const member = await db.query.members.findFirst({
      where: eq(members.bankAccountNo, payment.senderAccountNo),
      columns: { id: true, name: true },
    });
    if (member) matchedMember = member;
  }

  // 4. Route based on intent
  let result: MatchResult;
  if (intent.type === "fund_contribution" && matchedMember) {
    result = await matchFundContribution(payment, matchedMember);
  } else if (intent.type === "session_debt") {
    result = await matchSessionDebt(payment, intent, matchedMember);
  } else if (matchedMember) {
    result = await matchOldestDebt(payment, matchedMember);
  } else {
    result = {
      status: "pending",
      message: "Không xác định được người chuyển hoặc mục đích",
    };
  }

  // 5. Update notification row with final status / linked records
  await db
    .update(paymentNotifications)
    .set({
      matchedDebtId: result.debtId ?? null,
      matchedTransactionId: result.transactionId ?? null,
      status:
        result.status === "matched_debt" || result.status === "matched_fund"
          ? "matched"
          : "pending",
    })
    .where(eq(paymentNotifications.id, notificationId));

  // 6. Revalidate — even on pending, so admin's inbox shows the new entry
  revalidatePath("/admin/finance");
  if (result.status === "matched_debt" || result.status === "matched_fund") {
    revalidatePath("/admin/fund");
    revalidatePath("/my-debts");
    revalidatePath("/my-fund");
  }

  return result;
}

// ─── Match: Fund Contribution ───

async function matchFundContribution(
  payment: ParsedTimoPayment,
  member: { id: number; name: string },
): Promise<MatchResult> {
  const isActive = await isFundMember(member.id);
  if (!isActive) {
    return {
      status: "pending",
      memberId: member.id,
      message: `${member.name} không phải thành viên quỹ`,
    };
  }

  const tx = await recordFinancialTransaction({
    type: "fund_contribution",
    direction: "in",
    amount: payment.amount,
    memberId: member.id,
    description: `CK Timo: ${payment.memo || payment.transId}`,
    metadata: { transId: payment.transId },
  });
  if ("error" in tx)
    return {
      status: "pending",
      memberId: member.id,
      message: tx.error ?? "Lỗi ghi sổ",
    };

  return {
    status: "matched_fund",
    transactionId: tx.id,
    memberId: member.id,
    message: `Đóng quỹ ${member.name}: ${formatVND(payment.amount)}`,
  };
}

// ─── Match: Session Debt ───

async function matchSessionDebt(
  payment: ParsedTimoPayment,
  intent: ReturnType<typeof parseMemoIntent>,
  member: { id: number; name: string } | null,
): Promise<MatchResult> {
  let debt: { id: number; memberId: number; totalAmount: number } | undefined;

  if (intent.sessionId && member) {
    debt =
      (await db.query.sessionDebts.findFirst({
        where: and(
          eq(sessionDebts.sessionId, intent.sessionId),
          eq(sessionDebts.memberId, member.id),
          eq(sessionDebts.memberConfirmed, false),
        ),
        columns: { id: true, memberId: true, totalAmount: true },
      })) ?? undefined;
  } else if (intent.sessionDate && member) {
    const [day, month] = intent.sessionDate.split("/");
    const datePattern = `-${month}-${day}`;

    const matchingSessions = await db.query.sessions.findMany({
      columns: { id: true, date: true },
    });

    for (const s of matchingSessions) {
      if (s.date.includes(datePattern) || s.date.endsWith(`${month}-${day}`)) {
        debt =
          (await db.query.sessionDebts.findFirst({
            where: and(
              eq(sessionDebts.sessionId, s.id),
              eq(sessionDebts.memberId, member.id),
              eq(sessionDebts.memberConfirmed, false),
            ),
            columns: { id: true, memberId: true, totalAmount: true },
          })) ?? undefined;
        if (debt) break;
      }
    }
  }

  if (!debt) {
    return {
      status: "pending",
      memberId: member?.id,
      message: member
        ? `Không tìm thấy nợ chưa thanh toán cho ${member.name}`
        : "Không xác định được người chuyển",
    };
  }

  // Accept overpayment (≥ debt). Underpayment → admin reviews.
  if (payment.amount < debt.totalAmount) {
    return {
      status: "pending",
      memberId: debt.memberId,
      message: `Số tiền chuyển ${formatVND(payment.amount)} thiếu so với nợ ${formatVND(debt.totalAmount)}`,
    };
  }

  return confirmDebtFromBankTransfer(payment, debt, member?.name ?? "");
}

// ─── Match: Oldest Unpaid Debt ───

async function matchOldestDebt(
  payment: ParsedTimoPayment,
  member: { id: number; name: string },
): Promise<MatchResult> {
  const debt = await db.query.sessionDebts.findFirst({
    where: and(
      eq(sessionDebts.memberId, member.id),
      eq(sessionDebts.memberConfirmed, false),
    ),
    orderBy: [asc(sessionDebts.id)],
    columns: { id: true, memberId: true, totalAmount: true },
  });

  if (!debt) {
    const isActive = await isFundMember(member.id);
    if (isActive) {
      return matchFundContribution(payment, member);
    }
    return {
      status: "pending",
      memberId: member.id,
      message: `${member.name} không có nợ chưa thanh toán`,
    };
  }
  if (payment.amount < debt.totalAmount) {
    return {
      status: "pending",
      memberId: member.id,
      message: `Số tiền chuyển ${formatVND(payment.amount)} thiếu so với nợ ${formatVND(debt.totalAmount)}`,
    };
  }

  return confirmDebtFromBankTransfer(payment, debt, member.name);
}

// ─── Shared: confirm a debt as paid by bank transfer (atomic) ───

async function confirmDebtFromBankTransfer(
  payment: ParsedTimoPayment,
  debt: { id: number; memberId: number; totalAmount: number },
  memberName: string,
): Promise<MatchResult> {
  const now = new Date().toISOString();
  let txId: number | undefined;

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(sessionDebts)
        .set({ memberConfirmed: true, memberConfirmedAt: now })
        .where(eq(sessionDebts.id, debt.id));

      const r = await recordFinancialTransaction(
        {
          type: "bank_payment_received",
          direction: "in",
          amount: payment.amount,
          memberId: debt.memberId,
          debtId: debt.id,
          description: `Nhận chuyển khoản nợ #${debt.id}`,
          metadata: {
            transId: payment.transId,
            memo: payment.memo,
            overpaidBy: payment.amount - debt.totalAmount,
          },
        },
        tx,
      );
      if ("error" in r) throw new Error(r.error);
      txId = r.id;
    });
  } catch (err) {
    return {
      status: "pending",
      memberId: debt.memberId,
      message:
        err instanceof Error ? err.message : "Không ghi nhận được giao dịch",
    };
  }

  const overpay = payment.amount - debt.totalAmount;
  return {
    status: "matched_debt",
    debtId: debt.id,
    transactionId: txId,
    memberId: debt.memberId,
    message:
      overpay > 0
        ? `Xác nhận nợ #${debt.id}${memberName ? ` cho ${memberName}` : ""} (dư ${formatVND(overpay)})`
        : `Xác nhận thanh toán nợ #${debt.id}${memberName ? ` cho ${memberName}` : ""}`,
  };
}

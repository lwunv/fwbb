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
import {
  members,
  sessionDebts,
  paymentNotifications,
  sessions,
} from "@/db/schema";
import { eq, and, asc, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { parseMemoIntent, type ParsedTimoPayment } from "./timo-parser";
import { isFundMember } from "./fund-calculator";
import { recordFinancialTransaction } from "./financial-ledger";
import { formatVND, roundToThousand } from "./utils";

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

  // 4. Route based on intent. Each match function updates the notification
  // status inside its OWN transaction (atomic with the ledger inserts), so
  // we never end up with "ledger says matched but notification still
  // pending" — that asymmetry was previously possible if step 5's UPDATE
  // failed mid-flight.
  let result: MatchResult;
  if (intent.type === "all_debts" && intent.memberId !== null) {
    // Memo nói rõ memberId qua "NO {id}" — không cần senderAccountNo
    result = await matchAllDebts(payment, intent.memberId, notificationId);
  } else if (intent.type === "fund_contribution") {
    // Ưu tiên memberId từ memo "QUY {id}", fallback senderAccountNo
    let target = matchedMember;
    if (intent.memberId !== null) {
      const m = await db.query.members.findFirst({
        where: eq(members.id, intent.memberId),
        columns: { id: true, name: true },
      });
      if (m) target = m;
    }
    if (target) {
      result = await matchFundContribution(payment, target, notificationId);
    } else {
      result = {
        status: "pending",
        message: "Không xác định được người đóng quỹ",
      };
    }
  } else if (intent.type === "session_debt") {
    result = await matchSessionDebt(
      payment,
      intent,
      matchedMember,
      notificationId,
    );
  } else if (matchedMember) {
    result = await matchOldestDebt(payment, matchedMember, notificationId);
  } else {
    result = {
      status: "pending",
      message: "Không xác định được người chuyển hoặc mục đích",
    };
  }

  // 5. If the match path didn't run an inner transaction (the "no member /
  // no intent" pending fallbacks), notification still has status="pending"
  // from the initial insert — that's already correct. Revalidate so admin's
  // inbox shows the new entry.
  revalidatePath("/admin/finance");
  if (result.status === "matched_debt" || result.status === "matched_fund") {
    revalidatePath("/admin/fund");
    revalidatePath("/my-debts");
    revalidatePath("/my-fund");
  }

  return result;
}

/**
 * Helper: inside an inner match's transaction, finalise the
 * paymentNotifications row in lock-step with the ledger writes. Atomic =
 * if the tx rolls back, neither the ledger nor the notification status
 * change.
 */
async function finalizeNotification(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  notificationId: number | undefined,
  result: {
    status: MatchResult["status"];
    debtId?: number;
    transactionId?: number;
  },
) {
  if (notificationId === undefined) return;
  const matched =
    result.status === "matched_debt" || result.status === "matched_fund";
  await tx
    .update(paymentNotifications)
    .set({
      matchedDebtId: result.debtId ?? null,
      matchedTransactionId: result.transactionId ?? null,
      status: matched ? "matched" : "pending",
    })
    .where(eq(paymentNotifications.id, notificationId));
}

// ─── Match: Fund Contribution ───

async function matchFundContribution(
  payment: ParsedTimoPayment,
  member: { id: number; name: string },
  notificationId?: number,
): Promise<MatchResult> {
  const isActive = await isFundMember(member.id);
  if (!isActive) {
    return {
      status: "pending",
      memberId: member.id,
      message: `${member.name} không phải thành viên quỹ`,
    };
  }

  let txId: number | undefined;
  try {
    await db.transaction(async (innerTx) => {
      const r = await recordFinancialTransaction(
        {
          type: "fund_contribution",
          direction: "in",
          amount: payment.amount,
          memberId: member.id,
          description: `CK Timo: ${payment.memo || payment.transId}`,
          metadata: { transId: payment.transId },
          idempotencyKey: `bank-fund-contribution-${payment.transId}`,
        },
        innerTx,
      );
      if ("error" in r) throw new Error(r.error);
      txId = r.id;
      await finalizeNotification(innerTx, notificationId, {
        status: "matched_fund",
        transactionId: r.id,
      });
    });
  } catch (err) {
    return {
      status: "pending",
      memberId: member.id,
      message: err instanceof Error ? err.message : "Lỗi ghi sổ",
    };
  }

  // Auto-settle outstanding session debts with the new balance.
  const { autoApplyFundToDebts } = await import("@/actions/auto-fund");
  await autoApplyFundToDebts(member.id);

  return {
    status: "matched_fund",
    transactionId: txId,
    memberId: member.id,
    message: `Đóng quỹ ${member.name}: ${formatVND(payment.amount)}`,
  };
}

// ─── Match: Session Debt ───

async function matchSessionDebt(
  payment: ParsedTimoPayment,
  intent: ReturnType<typeof parseMemoIntent>,
  member: { id: number; name: string } | null,
  notificationId?: number,
): Promise<MatchResult> {
  let debt: { id: number; memberId: number; totalAmount: number } | undefined;

  // Helper: load debt only if the parent session is NOT cancelled.
  async function loadDebtForSession(sessionId: number, memberId: number) {
    const session = await db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      columns: { status: true },
    });
    if (!session || session.status === "cancelled") return undefined;
    return (
      (await db.query.sessionDebts.findFirst({
        where: and(
          eq(sessionDebts.sessionId, sessionId),
          eq(sessionDebts.memberId, memberId),
          eq(sessionDebts.memberConfirmed, false),
        ),
        columns: { id: true, memberId: true, totalAmount: true },
      })) ?? undefined
    );
  }

  if (intent.sessionId && member) {
    debt = await loadDebtForSession(intent.sessionId, member.id);
  } else if (intent.sessionDate && member) {
    const [day, month] = intent.sessionDate.split("/");
    const datePattern = `-${month}-${day}`;

    // Only consider non-cancelled sessions when scanning by date pattern.
    const matchingSessions = await db.query.sessions.findMany({
      where: ne(sessions.status, "cancelled"),
      columns: { id: true, date: true },
    });

    for (const s of matchingSessions) {
      if (s.date.includes(datePattern) || s.date.endsWith(`${month}-${day}`)) {
        debt = await loadDebtForSession(s.id, member.id);
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

  return confirmDebtFromBankTransfer(
    payment,
    debt,
    member?.name ?? "",
    notificationId,
  );
}

// ─── Match: Pay-all-unpaid-debts (memo "NO {memberId}") ───
//
// Số tiền trong từng debt đã được làm tròn LÊN nghìn (`roundToThousand`) khi
// tạo nợ, nên tổng nợ luôn là bội số của 1,000 — `payment.amount` từ ngân hàng
// sẽ khớp chính xác. Vẫn round-up tổng để defensive (không bao giờ thiệt admin).

async function matchAllDebts(
  payment: ParsedTimoPayment,
  memberId: number,
  notificationId?: number,
): Promise<MatchResult> {
  const member = await db.query.members.findFirst({
    where: eq(members.id, memberId),
    columns: { id: true, name: true },
  });
  if (!member) {
    return {
      status: "pending",
      message: `Memo NO ${memberId}: không tìm thấy member`,
    };
  }

  // Inner-join via JS: load all candidate debts then drop ones whose parent
  // session was cancelled. SQLite doesn't support multi-table JOIN with the
  // findMany builder we use here, so we filter post-fetch.
  const candidateDebts = await db.query.sessionDebts.findMany({
    where: and(
      eq(sessionDebts.memberId, memberId),
      eq(sessionDebts.memberConfirmed, false),
    ),
    with: { session: { columns: { status: true } } },
    orderBy: [asc(sessionDebts.id)],
    columns: { id: true, totalAmount: true },
  });
  const unpaid = candidateDebts
    .filter((d) => d.session?.status !== "cancelled")
    .map((d) => ({ id: d.id, totalAmount: d.totalAmount }));

  if (unpaid.length === 0) {
    // Không nợ — nếu là fund member thì coi như nạp quỹ
    const isActive = await isFundMember(memberId);
    if (isActive) return matchFundContribution(payment, member, notificationId);
    return {
      status: "pending",
      memberId,
      message: `${member.name} không có nợ chưa thanh toán`,
    };
  }

  const totalOwed = roundToThousand(
    unpaid.reduce((s, d) => s + d.totalAmount, 0),
  );

  if (payment.amount < totalOwed) {
    return {
      status: "pending",
      memberId,
      message: `Số tiền chuyển ${formatVND(payment.amount)} thiếu so với tổng nợ ${formatVND(totalOwed)} (${unpaid.length} khoản)`,
    };
  }

  const overpay = payment.amount - totalOwed;
  const now = new Date().toISOString();
  let firstTxId: number | undefined;

  try {
    await db.transaction(async (tx) => {
      for (const debt of unpaid) {
        // Bank webhook is a strong-authenticity signal (Pub/Sub OIDC + Gmail
        // DKIM): once tiền đã thực sự về tài khoản admin, BOTH flags should
        // flip — admin already has the money.
        await tx
          .update(sessionDebts)
          .set({
            memberConfirmed: true,
            memberConfirmedAt: now,
            adminConfirmed: true,
            adminConfirmedAt: now,
          })
          .where(eq(sessionDebts.id, debt.id));

        const r = await recordFinancialTransaction(
          {
            type: "bank_payment_received",
            direction: "in",
            amount: debt.totalAmount,
            memberId,
            debtId: debt.id,
            description: `Thanh toán toàn bộ nợ — debt #${debt.id}`,
            metadata: {
              transId: payment.transId,
              memo: payment.memo,
              partOfBulkPayment: true,
              bulkTotal: totalOwed,
              bulkDebtCount: unpaid.length,
            },
            // Per-debt idempotency — same transId can map to multiple
            // bank_payment_received rows when paying many debts in one
            // transfer, so include debt.id in the key.
            idempotencyKey: `bank-payment-${payment.transId}-${debt.id}`,
          },
          tx,
        );
        if ("error" in r) throw new Error(r.error);
        if (firstTxId === undefined) firstTxId = r.id;

        // Audit row + balance fix — see confirmDebtFromBankTransfer for
        // rationale. Each debt gets its own paired pair of ledger rows
        // so reconcile invariants and per-member balance work the same
        // as a single-debt transfer.
        const audit = await recordFinancialTransaction(
          {
            type: "debt_admin_confirmed",
            direction: "neutral",
            amount: debt.totalAmount,
            memberId,
            debtId: debt.id,
            description: "Bank webhook tự xác nhận admin đã nhận tiền (bulk)",
            metadata: { transId: payment.transId, autoConfirmedByBank: true },
            idempotencyKey: `debt-admin-confirm-${debt.id}`,
          },
          tx,
        );
        if ("error" in audit) throw new Error(audit.error);

        const balanceFix = await recordFinancialTransaction(
          {
            type: "fund_contribution",
            direction: "in",
            amount: debt.totalAmount,
            memberId,
            debtId: debt.id,
            description: `Cân bằng quỹ — đã trả nợ #${debt.id} qua chuyển khoản (bulk)`,
            metadata: { transId: payment.transId, balancesDebt: true },
            idempotencyKey: `bank-payment-balance-${debt.id}`,
          },
          tx,
        );
        if ("error" in balanceFix) throw new Error(balanceFix.error);
      }

      // Atomic notification update — committed together with the ledger.
      await finalizeNotification(tx, notificationId, {
        status: "matched_debt",
        debtId: unpaid[0].id,
        transactionId: firstTxId,
      });
    });
  } catch (err) {
    return {
      status: "pending",
      memberId,
      message:
        err instanceof Error ? err.message : "Không ghi nhận được giao dịch",
    };
  }

  return {
    status: "matched_debt",
    debtId: unpaid[0].id,
    transactionId: firstTxId,
    memberId,
    message:
      overpay > 0
        ? `Tất toán ${unpaid.length} nợ cho ${member.name} (dư ${formatVND(overpay)})`
        : `Tất toán ${unpaid.length} nợ cho ${member.name} (${formatVND(totalOwed)})`,
  };
}

// ─── Match: Oldest Unpaid Debt ───

async function matchOldestDebt(
  payment: ParsedTimoPayment,
  member: { id: number; name: string },
  notificationId?: number,
): Promise<MatchResult> {
  // Filter out cancelled sessions — money for them shouldn't get matched.
  const candidates = await db.query.sessionDebts.findMany({
    where: and(
      eq(sessionDebts.memberId, member.id),
      eq(sessionDebts.memberConfirmed, false),
    ),
    with: { session: { columns: { status: true } } },
    orderBy: [asc(sessionDebts.id)],
    columns: { id: true, memberId: true, totalAmount: true },
  });
  const debt = candidates.find((d) => d.session?.status !== "cancelled");

  if (!debt) {
    const isActive = await isFundMember(member.id);
    if (isActive) {
      return matchFundContribution(payment, member, notificationId);
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

  return confirmDebtFromBankTransfer(
    payment,
    debt,
    member.name,
    notificationId,
  );
}

// ─── Shared: confirm a debt as paid by bank transfer (atomic) ───

async function confirmDebtFromBankTransfer(
  payment: ParsedTimoPayment,
  debt: { id: number; memberId: number; totalAmount: number },
  memberName: string,
  notificationId?: number,
): Promise<MatchResult> {
  const now = new Date().toISOString();
  let txId: number | undefined;

  try {
    await db.transaction(async (tx) => {
      // Bank money has actually arrived in admin's account — flip both flags.
      // Member said "yes I paid" (memberConfirmed) AND admin's bank confirms
      // receipt (adminConfirmed). This avoids leaving the debt as
      // "pending review" forever when the strongest possible signal already
      // arrived.
      await tx
        .update(sessionDebts)
        .set({
          memberConfirmed: true,
          memberConfirmedAt: now,
          adminConfirmed: true,
          adminConfirmedAt: now,
        })
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
          // Idempotent at ledger level — `transId` is unique per Timo
          // transaction, and we may receive the same Pub/Sub message
          // twice (gmailMessageId UNIQUE catches duplicates upstream,
          // this is belt-and-suspenders).
          idempotencyKey: `bank-payment-${payment.transId}`,
        },
        tx,
      );
      if ("error" in r) throw new Error(r.error);
      txId = r.id;

      // Audit row mirroring `confirmPaymentByAdmin`'s ledger event so
      // reconciliation can correlate "bank_payment_received" with an
      // explicit "debt_admin_confirmed" event. Without this, the ledger
      // history of an auto-confirmed debt is asymmetric vs. one
      // confirmed manually by admin — same end-state, different audit.
      const audit = await recordFinancialTransaction(
        {
          type: "debt_admin_confirmed",
          direction: "neutral",
          amount: debt.totalAmount,
          memberId: debt.memberId,
          debtId: debt.id,
          description: "Bank webhook tự xác nhận admin đã nhận tiền",
          metadata: {
            transId: payment.transId,
            autoConfirmedByBank: true,
          },
          idempotencyKey: `debt-admin-confirm-${debt.id}`,
        },
        tx,
      );
      if ("error" in audit) throw new Error(audit.error);

      // Balance the merged Quỹ + Nợ ledger: when finalize ran, member
      // got a `fund_deduction = -debt.totalAmount` → balance went
      // negative ("còn nợ"). Now that money has actually arrived in the
      // bank, insert a matching `fund_contribution = +debt.totalAmount`
      // so the member's fund balance returns to whatever it was before
      // the session debt was deducted. Without this, "my-fund" would
      // still show a negative balance even after they paid.
      const balanceFix = await recordFinancialTransaction(
        {
          type: "fund_contribution",
          direction: "in",
          amount: debt.totalAmount,
          memberId: debt.memberId,
          debtId: debt.id,
          description: `Cân bằng quỹ — đã trả nợ #${debt.id} qua chuyển khoản`,
          metadata: {
            transId: payment.transId,
            balancesDebt: true,
          },
          idempotencyKey: `bank-payment-balance-${debt.id}`,
        },
        tx,
      );
      if ("error" in balanceFix) throw new Error(balanceFix.error);

      // Atomic notification update — committed together with the ledger.
      await finalizeNotification(tx, notificationId, {
        status: "matched_debt",
        debtId: debt.id,
        transactionId: txId,
      });
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

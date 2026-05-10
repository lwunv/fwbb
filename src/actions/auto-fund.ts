"use server";

import { db } from "@/db";
import { sessionDebts, financialTransactions } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { isFundMember } from "@/lib/fund-calculator";
import { computeBalanceFromTransactions } from "@/lib/fund-core";
import { recordFinancialTransaction } from "@/lib/financial-ledger";
import { getUserFromCookie } from "@/lib/user-identity";
import { checkRateLimit } from "@/lib/rate-limit";
import { getTranslations } from "next-intl/server";

export interface AutoApplyResult {
  appliedCount: number;
  appliedTotal: number;
  remainingBalance: number;
}

/**
 * Tự động trừ quỹ thanh toán các khoản nợ chưa trả của member.
 * Áp dụng oldest-first: đi từ debt có id nhỏ nhất, deduct full nếu balance đủ,
 * stop khi balance không đủ trả debt kế tiếp (không partial vì DB không track paidAmount).
 *
 * Idempotent: chỉ confirm các debt unpaid (memberConfirmed=false AND adminConfirmed=false).
 * Mỗi lần gọi sẽ tự dừng khi không còn debt unpaid hoặc balance không đủ.
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
            type: "fund_deduction",
            direction: "out",
            amount: debt.totalAmount,
            memberId,
            sessionId: debt.sessionId,
            debtId: debt.id,
            description: `Auto trừ quỹ — debt #${debt.id}`,
            metadata: { autoApplied: true },
            idempotencyKey: `auto-apply-debt-${debt.id}`,
          },
          tx,
        );
        if ("error" in r) throw new Error(r.error);

        balance -= debt.totalAmount;
        appliedTotal += debt.totalAmount;
        appliedCount++;
      }
      finalBalance = balance;
    });
  } catch {
    // On error, balance reverts; return zero applied
    return { appliedCount: 0, appliedTotal: 0, remainingBalance: 0 };
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

/**
 * Member tự xác nhận đã chuyển khoản đóng quỹ — đặt vào pending để admin review.
 * Tạo payment_notifications row với senderBank="manual" để admin thấy + confirm thủ công.
 *
 * SECURITY: memberId được lấy duy nhất từ cookie (`getUserFromCookie`).
 * Tuyệt đối KHÔNG nhận memberId từ tham số client — trước đây attacker có thể
 * spoof claim đứng tên người khác để rút quỹ giả khi admin confirm.
 *
 * Idempotency: client truyền `idempotencyKey` (UUID sinh khi mở modal). Cùng
 * key → trả về kết quả cũ thay vì insert claim trùng. Phía DB cũng có
 * `gmailMessageId UNIQUE`, là last line of defence dưới mọi race condition.
 *
 * Rate limit: 10 claim / member / 5 phút — chống flood pending queue.
 * Bound: 1.000đ ≤ amount ≤ 100.000.000đ (khớp `fundContributionSchema`).
 */
export async function claimFundContribution(
  amount: number,
  idempotencyKey?: string,
): Promise<{ success: true; replayed?: boolean } | { error: string }> {
  const t = await getTranslations("serverErrors");
  const user = await getUserFromCookie();
  if (!user) return { error: t("requireLogin") };
  const memberId = user.memberId;

  if (
    !Number.isFinite(amount) ||
    !Number.isInteger(amount) ||
    amount < 1_000 ||
    amount > 100_000_000
  ) {
    return { error: t("invalidContribAmount") };
  }
  const inFund = await isFundMember(memberId);
  if (!inFund) {
    return { error: t("notInFund") };
  }

  const rl = await checkRateLimit(`claim-fund:${memberId}`, 10, 5 * 60_000);
  if (!rl.ok) {
    return {
      error: t("tooManyActions", { seconds: rl.retryAfter ?? 300 }),
    };
  }

  const { paymentNotifications } = await import("@/db/schema");
  // gmailMessageId is the natural unique key on payment_notifications. Use the
  // client-supplied idempotency key when available, fall back to a per-second
  // timestamp (legacy behaviour) otherwise.
  const gmailMessageId = idempotencyKey
    ? `manual-fund-${memberId}-${idempotencyKey}`
    : `manual-fund-${memberId}-${Date.now()}`;

  // Pre-check the unique key — if a prior submit landed it, return success
  // (replayed). The UNIQUE INDEX on gmailMessageId still catches concurrent
  // races at DB level.
  const existing = await db.query.paymentNotifications.findFirst({
    where: (t, { eq }) => eq(t.gmailMessageId, gmailMessageId),
    columns: { id: true },
  });
  if (existing) {
    return { success: true, replayed: true };
  }

  try {
    await db.insert(paymentNotifications).values({
      gmailMessageId,
      senderBank: "manual",
      amount,
      transferContent: `FWBB QUY ${memberId}`,
      senderAccountNo: null,
      status: "pending",
      rawSnippet: `Member ${memberId} self-claim fund top-up ${amount}`,
    });
  } catch (err) {
    // Lost the race — the winner already inserted. Treat as replay.
    const winner = await db.query.paymentNotifications.findFirst({
      where: (t, { eq }) => eq(t.gmailMessageId, gmailMessageId),
      columns: { id: true },
    });
    if (winner) return { success: true, replayed: true };
    return {
      error:
        "Không ghi được claim: " +
        (err instanceof Error ? err.message : "lỗi không xác định"),
    };
  }

  revalidatePath("/admin/finance");
  revalidatePath("/admin/fund");
  return { success: true };
}

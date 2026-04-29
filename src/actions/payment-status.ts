"use server";

import { db } from "@/db";
import { paymentNotifications, sessionDebts } from "@/db/schema";
import { and, gte, like, eq, desc } from "drizzle-orm";
import { getUserFromCookie } from "@/lib/user-identity";
import { getAdminFromCookie } from "@/lib/auth";

export interface PaymentStatusResult {
  received: boolean;
  matched: boolean;
  amount?: number;
  receivedAt?: string;
  transferContent?: string;
}

/**
 * Kiểm tra xem có payment notification nào với memo khớp đã nhận chưa.
 * Dùng cho client-side polling khi user đang xem QR code — phát hiện
 * giao dịch chuyển khoản gần đây qua Gmail Pub/Sub webhook.
 *
 * `memo` được match LIKE %memo% case-insensitive (Timo có thể strip dấu, viết hoa/thường).
 * Default time window = 30 phút để tránh match nhầm payment cũ.
 *
 * SECURITY: yêu cầu cookie user và memo phải kèm tiền tố
 * `FWBB QUY <user.memberId>` hoặc `FWBB NO <user.memberId>`. Trước fix,
 * unauth caller có thể gửi memo "FWBB" để LIKE match toàn bộ payment, leak
 * amount/sender content của mọi member khác.
 */
export async function checkPaymentForMemo(
  memo: string,
  sinceMinutes = 30,
): Promise<PaymentStatusResult> {
  const user = await getUserFromCookie();
  if (!user) return { received: false, matched: false };

  if (!memo || memo.trim().length < 3) {
    return { received: false, matched: false };
  }

  const memoNorm = memo.trim().toUpperCase();
  // Memo phải khớp 1 trong 2 prefix hợp lệ của user gọi.
  const allowedPrefixes = [
    `FWBB QUY ${user.memberId}`,
    `FWBB NO ${user.memberId}`,
  ];
  const matchesOwner = allowedPrefixes.some((p) => memoNorm.startsWith(p));
  if (!matchesOwner) return { received: false, matched: false };

  const since = new Date(Date.now() - sinceMinutes * 60_000).toISOString();

  // SQLite LIKE is case-insensitive by default for ASCII; we match against
  // the normalized memo text since Timo memos may be uppercased/stripped.
  const rows = await db
    .select({
      id: paymentNotifications.id,
      amount: paymentNotifications.amount,
      transferContent: paymentNotifications.transferContent,
      status: paymentNotifications.status,
      receivedAt: paymentNotifications.receivedAt,
    })
    .from(paymentNotifications)
    .where(
      and(
        gte(paymentNotifications.receivedAt, since),
        like(paymentNotifications.transferContent, `%${memoNorm}%`),
      ),
    )
    .orderBy(desc(paymentNotifications.receivedAt))
    .limit(1);

  if (rows.length === 0) {
    return { received: false, matched: false };
  }

  const row = rows[0];
  return {
    received: true,
    matched: row.status === "matched",
    amount: row.amount ?? undefined,
    receivedAt: row.receivedAt ?? undefined,
    transferContent: row.transferContent ?? undefined,
  };
}

/**
 * Variant: kiểm tra qua matchedDebtId — chính xác hơn khi biết debtId.
 * Dùng cho từng DebtCard để biết debt nào đã được auto-match.
 *
 * SECURITY: chỉ chủ debt hoặc admin được hỏi.
 */
export async function checkPaymentForDebt(
  debtId: number,
): Promise<PaymentStatusResult> {
  const [user, admin] = await Promise.all([
    getUserFromCookie(),
    getAdminFromCookie(),
  ]);
  const isAdmin = admin?.role === "admin";
  if (!user && !isAdmin) return { received: false, matched: false };

  // Verify ownership before exposing payment metadata.
  if (!isAdmin) {
    const debt = await db.query.sessionDebts.findFirst({
      where: eq(sessionDebts.id, debtId),
      columns: { memberId: true },
    });
    if (!debt || debt.memberId !== user?.memberId) {
      return { received: false, matched: false };
    }
  }

  const rows = await db
    .select({
      amount: paymentNotifications.amount,
      transferContent: paymentNotifications.transferContent,
      receivedAt: paymentNotifications.receivedAt,
      status: paymentNotifications.status,
    })
    .from(paymentNotifications)
    .where(
      and(
        eq(paymentNotifications.matchedDebtId, debtId),
        eq(paymentNotifications.status, "matched"),
      ),
    )
    .orderBy(desc(paymentNotifications.receivedAt))
    .limit(1);

  if (rows.length === 0) {
    return { received: false, matched: false };
  }

  const row = rows[0];
  return {
    received: true,
    matched: true,
    amount: row.amount ?? undefined,
    receivedAt: row.receivedAt ?? undefined,
    transferContent: row.transferContent ?? undefined,
  };
}

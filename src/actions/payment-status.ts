"use server";

import { db } from "@/db";
import { paymentNotifications, sessionDebts } from "@/db/schema";
import { and, gte, like, eq, desc } from "drizzle-orm";
import { getUserFromCookie } from "@/lib/user-identity";
import { getAdminFromCookie } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";

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

  // Polling action (client polls every ~4s) — cap per member so it can't be
  // looped into an unbounded LIKE-scan cost amplifier. Degrade silently.
  const rl = await checkRateLimit(`pay-status:${user.memberId}`, 20, 60_000);
  if (!rl.ok) return { received: false, matched: false };

  if (!memo || memo.trim().length < 3) {
    return { received: false, matched: false };
  }

  const memoNorm = memo.trim().toUpperCase();
  // Memo phải khớp 1 trong 2 prefix hợp lệ của user gọi.
  //
  // SECURITY: require an explicit boundary after the id to prevent cross-
  // member leakage. With raw `startsWith("FWBB QUY 1")`, caller id=1 also
  // matches "FWBB QUY 12 ..." (target id=12) — they could probe another
  // member's incoming payment events.
  const allowedPrefixes = [
    `FWBB QUY ${user.memberId}`,
    `FWBB NO ${user.memberId}`,
  ];
  const matchesOwner = allowedPrefixes.some(
    (p) => memoNorm === p || memoNorm.startsWith(`${p} `),
  );
  if (!matchesOwner) return { received: false, matched: false };

  // Compare in the SAME timestamp format the column actually stores. received_at
  // defaults to SQLite current_timestamp → "YYYY-MM-DD HH:MM:SS" (UTC, space
  // separator, no ms/Z). Building `since` with a raw toISOString() (T separator)
  // made the lexicographic gte() drop same-day rows (' ' 0x20 < 'T' 0x54), so
  // the 30-min window never matched a genuinely recent transfer.
  const since = new Date(Date.now() - sinceMinutes * 60_000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");

  // Anchor the memo match to THIS member's id with a non-digit boundary. A bare
  // LIKE %FWBB QUY 5% substring-matches "FWBB QUY 50 ..." (member 50), leaking
  // their amount + sender name (PII) and falsely reporting "received". The LIKE
  // narrows candidates; the regex enforces the exact-id boundary in JS.
  const memoBoundary = new RegExp(
    `${memoNorm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\d)`,
    "i",
  );
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
    .limit(20);

  const row = rows.find(
    (r) => r.transferContent && memoBoundary.test(r.transferContent),
  );
  if (!row) {
    return { received: false, matched: false };
  }

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

  if (user) {
    const rl = await checkRateLimit(`pay-status:${user.memberId}`, 20, 60_000);
    if (!rl.ok) return { received: false, matched: false };
  }

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

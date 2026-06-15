"use server";

import { db } from "@/db";
import { revalidatePath } from "next/cache";
import { isFundMember } from "@/lib/fund-calculator";
import { requireApprovedMember } from "@/lib/member-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getTranslations } from "next-intl/server";

// NOTE: autoApplyFundToDebts moved to src/lib/auto-fund-core.ts — it is an
// internal helper, NOT a server action. Exporting it from a "use server" file
// made it a public unauthenticated RPC endpoint that could force-deduct any
// member's fund. Callers (fund.ts, payment-matcher.ts) import it from the lib.

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
  const auth = await requireApprovedMember();
  if ("error" in auth) return { error: auth.error };
  const memberId = auth.user.memberId;

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

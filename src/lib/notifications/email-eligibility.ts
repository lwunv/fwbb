import { and, eq } from "drizzle-orm";
import { admins, members, notificationPrefs } from "@/db/schema";
import type { DbOrTx } from "@/db/tx";
import type { Recipient } from "./recipients";

/**
 * Người nhận có được gửi email thông báo không, và gửi tới đâu. Member phải có
 * email ĐÃ xác minh cho đúng địa chỉ hiện tại (đổi email thì mất hiệu lực);
 * admin dùng `admins.email` tự điền, không cần xác minh. Cả hai phải chưa tắt
 * `emailEnabled` (mặc định bật). Gọi lúc xếp hàng và lại lúc gửi.
 */
export async function isEmailRecipientEligible(
  db: DbOrTx,
  r: Recipient,
): Promise<{ to: string } | null> {
  let to: string | null = null;
  if (r.type === "member") {
    const [m] = await db
      .select({
        email: members.email,
        verifiedFor: members.notifyEmailVerifiedFor,
      })
      .from(members)
      .where(eq(members.id, r.id))
      .limit(1);
    const email = m?.email?.trim();
    if (email && m?.verifiedFor === email.toLowerCase()) to = email;
  } else {
    const [a] = await db
      .select({ email: admins.email })
      .from(admins)
      .where(eq(admins.id, r.id))
      .limit(1);
    to = a?.email?.trim() || null;
  }
  if (!to) return null;

  const [prefs] = await db
    .select({ emailEnabled: notificationPrefs.emailEnabled })
    .from(notificationPrefs)
    .where(
      and(
        eq(notificationPrefs.recipientType, r.type),
        eq(notificationPrefs.recipientId, r.id),
      ),
    )
    .limit(1);
  if (prefs && !prefs.emailEnabled) return null;
  return { to };
}

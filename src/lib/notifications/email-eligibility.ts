import { and, inArray } from "drizzle-orm";
import { admins, members, notificationPrefs } from "@/db/schema";
import type { DbOrTx } from "@/db/tx";
import type { Recipient } from "./recipients";

const keyOf = (r: Recipient) => `${r.type}:${r.id}`;

/**
 * Bản theo lô của `isEmailRecipientEligible`, cùng luật, kết quả theo đúng thứ
 * tự `recipients`. Tối đa 3 truy vấn cho cả danh sách: `notify` gọi trong
 * transaction nghiệp vụ, mỗi người 2 truy vấn sẽ kéo dài tx theo số member.
 */
export async function emailEligibleRecipients(
  db: DbOrTx,
  recipients: Recipient[],
): Promise<Array<{ to: string } | null>> {
  const ids = (type: Recipient["type"]) =>
    Array.from(
      new Set(recipients.filter((r) => r.type === type).map((r) => r.id)),
    );
  const memberIds = ids("member");
  const adminIds = ids("admin");
  const to = new Map<string, string>();

  if (memberIds.length > 0) {
    const rows = await db
      .select({
        id: members.id,
        email: members.email,
        verifiedFor: members.notifyEmailVerifiedFor,
      })
      .from(members)
      .where(inArray(members.id, memberIds));
    for (const m of rows) {
      const email = m.email?.trim();
      if (email && m.verifiedFor === email.toLowerCase()) {
        to.set(`member:${m.id}`, email);
      }
    }
  }
  if (adminIds.length > 0) {
    const rows = await db
      .select({ id: admins.id, email: admins.email })
      .from(admins)
      .where(inArray(admins.id, adminIds));
    for (const a of rows) {
      const email = a.email?.trim();
      if (email) to.set(`admin:${a.id}`, email);
    }
  }
  if (to.size === 0) return recipients.map(() => null);

  const withEmail = recipients.filter((r) => to.has(keyOf(r)));
  const prefs = await db
    .select({
      recipientType: notificationPrefs.recipientType,
      recipientId: notificationPrefs.recipientId,
      emailEnabled: notificationPrefs.emailEnabled,
    })
    .from(notificationPrefs)
    .where(
      and(
        inArray(
          notificationPrefs.recipientType,
          Array.from(new Set(withEmail.map((r) => r.type))),
        ),
        inArray(
          notificationPrefs.recipientId,
          Array.from(new Set(withEmail.map((r) => r.id))),
        ),
      ),
    );
  const disabled = new Set(
    prefs
      .filter((p) => !p.emailEnabled)
      .map((p) => `${p.recipientType}:${p.recipientId}`),
  );

  return recipients.map((r) => {
    const k = keyOf(r);
    const email = to.get(k);
    return email && !disabled.has(k) ? { to: email } : null;
  });
}

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
  const [result] = await emailEligibleRecipients(db, [r]);
  return result;
}

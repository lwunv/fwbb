import { after } from "next/server";
import { desc, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { admins, financialTransactions, members } from "@/db/schema";
import { computeBalanceFromTransactions } from "@/lib/fund-core";
import { notificationHref } from "@/lib/admin-notifications-view";
import { sendAdminDebtAlertEmail } from "@/lib/mailer";

export type DebtCrossing = {
  memberId: number;
  balanceBefore: number;
  balanceAfter: number;
};

/**
 * Hẹn gửi mail báo admin cho những member vừa âm quỹ (quyết định user
 * 9/11/2026). Gọi TRONG tx tiền nhưng chỉ gửi SAU khi trả kết quả (`after()`),
 * để tx rollback thì không có mail ma. Ngoài request (script, test không mock)
 * thì bỏ qua: chạy ngay lúc đó sẽ đọc DB khi tx còn mở.
 */
export function scheduleDebtAlerts(crossings: DebtCrossing[]): void {
  if (crossings.length === 0) return;
  try {
    after(() => deliverDebtAlerts(crossings));
  } catch {
    // Ngoài request scope (script, migration lúc build): không gửi mail.
    // Chuông + trang thông báo vẫn thấy lần âm này vì chúng tính từ sổ cái.
    console.warn("[debt-alert] outside request scope, skipping mail", {
      count: crossings.length,
    });
  }
}

/**
 * Gửi mail thật. Đọc lại số dư ĐÃ COMMIT: không còn âm (tx đã rollback, hoặc
 * vừa nạp lại ngay) thì không gửi. Không log tên/email (dữ liệu cá nhân).
 */
export async function deliverDebtAlerts(crossings: DebtCrossing[]) {
  const ids = [...new Set(crossings.map((c) => c.memberId))];
  const [txRows, memberRows, adminRows] = await Promise.all([
    db
      .select({
        id: financialTransactions.id,
        memberId: financialTransactions.memberId,
        type: financialTransactions.type,
        amount: financialTransactions.amount,
        reversalOfId: financialTransactions.reversalOfId,
        description: financialTransactions.description,
      })
      .from(financialTransactions)
      .where(inArray(financialTransactions.memberId, ids))
      .orderBy(desc(financialTransactions.id)),
    db
      .select({ id: members.id, name: members.name })
      .from(members)
      .where(inArray(members.id, ids)),
    db
      .select({ email: admins.email })
      .from(admins)
      .where(isNotNull(admins.email)),
  ]);
  const to = [
    ...new Set(adminRows.map((a) => a.email).filter((e): e is string => !!e)),
  ];
  if (to.length === 0) return;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  for (const c of crossings) {
    const rows = txRows.filter((r) => r.memberId === c.memberId);
    const balance = computeBalanceFromTransactions(c.memberId, rows).balance;
    if (balance >= 0) continue;
    const name = memberRows.find((m) => m.id === c.memberId)?.name;
    if (!name) continue;
    const r = await sendAdminDebtAlertEmail(to, {
      memberName: name,
      balanceBefore: c.balanceBefore,
      balanceAfter: balance,
      // Dòng sổ mới nhất (rows đã sắp id giảm dần) là khoản vừa làm âm.
      description: rows[0]?.description ?? null,
      link: `${appUrl}${notificationHref(name)}`,
    });
    if (!r.success) {
      console.error("[debt-alert] mail not sent", {
        memberId: c.memberId,
        reason: r.error,
      });
    }
  }
}

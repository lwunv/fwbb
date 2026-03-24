import { getAllDebts } from "@/actions/finance";
import { getActiveMembers } from "@/actions/members";
import { getTranslations } from "next-intl/server";
import { AdminFinanceClient } from "./finance-client";

export default async function AdminFinancePage() {
  const t = await getTranslations("adminNav");

  const [debts, members] = await Promise.all([
    getAllDebts("all"),
    getActiveMembers(),
  ]);

  const memberPhones: Record<number, string> = {};
  for (const m of members) {
    memberPhones[m.id] = m.phone;
  }

  const debtCards = debts.map((d) => ({
    id: d.id,
    sessionId: d.sessionId,
    memberId: d.memberId,
    memberName: d.member.name,
    sessionDate: d.session.date,
    playAmount: d.playAmount ?? 0,
    dineAmount: d.dineAmount ?? 0,
    guestPlayAmount: d.guestPlayAmount ?? 0,
    guestDineAmount: d.guestDineAmount ?? 0,
    totalAmount: d.totalAmount,
    memberConfirmed: d.memberConfirmed ?? false,
    adminConfirmed: d.adminConfirmed ?? false,
  }));

  const totalOutstanding = debtCards
    .filter((d) => !d.adminConfirmed)
    .reduce((sum, d) => sum + d.totalAmount, 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("finance")}</h1>
      <AdminFinanceClient
        debts={debtCards}
        totalOutstanding={totalOutstanding}
        memberPhones={memberPhones}
      />
    </div>
  );
}

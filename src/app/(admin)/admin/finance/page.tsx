import { getAllDebts, getDebtSummary } from "@/actions/finance";
import { AdminFinanceClient } from "./finance-client";

export default async function AdminFinancePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period = "all" } = await searchParams;
  const [debts, summary] = await Promise.all([
    getAllDebts(period),
    getDebtSummary(),
  ]);

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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Quan ly tai chinh</h1>
      <AdminFinanceClient debts={debtCards} summary={summary} />
    </div>
  );
}

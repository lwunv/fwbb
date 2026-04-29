import {
  getFundMembersWithBalances,
  getAllFundTransactions,
  getFundOverview,
  getRecentFinancialTransactions,
} from "@/actions/fund";
import { mergeLegacyDebtsIntoFund } from "@/actions/merge-debt-fund";
import { db } from "@/db";
import { members } from "@/db/schema";
import { eq } from "drizzle-orm";
import { FundDashboard } from "./fund-dashboard";
import { FundReport } from "./fund-report";
import { FundTransactionLog } from "./fund-transaction-log";
import { ReconcilePanel } from "./reconcile-panel";

export default async function AdminFundPage() {
  // One-shot, idempotent: collapse any legacy unpaid session debts into the
  // unified fund balance. Cheap when there's nothing to migrate.
  await mergeLegacyDebtsIntoFund();

  const [
    overview,
    fundMembersWithBalances,
    transactions,
    allMembers,
    recentFinancialTransactions,
  ] = await Promise.all([
    getFundOverview(),
    getFundMembersWithBalances(),
    getAllFundTransactions(),
    db.query.members.findMany({ where: eq(members.isActive, true) }),
    getRecentFinancialTransactions(100),
  ]);

  // Merged Quỹ + Nợ: "Nợ chưa thu" = sum of negative balances.
  let totalOutstanding = 0;
  let owingCount = 0;
  for (const fm of fundMembersWithBalances) {
    if (fm.balance.balance < 0) {
      totalOutstanding += -fm.balance.balance;
      owingCount += 1;
    }
  }

  const txRows = recentFinancialTransactions.map((tx) => ({
    id: tx.id,
    memberId: tx.memberId,
    memberName: tx.member?.name ?? null,
    memberAvatarKey: tx.member?.avatarKey ?? null,
    memberAvatarUrl: tx.member?.avatarUrl ?? null,
    type: tx.type,
    direction: tx.direction,
    amount: tx.amount,
    description: tx.description,
    sessionDate: tx.session?.date ?? null,
    paymentNotificationId: tx.paymentNotificationId ?? null,
    createdAt: tx.createdAt ?? "",
  }));

  return (
    <div className="space-y-6">
      <FundDashboard
        overview={overview}
        fundMembers={fundMembersWithBalances}
        allMembers={allMembers}
        totalOutstanding={totalOutstanding}
        owingCount={owingCount}
      />
      <FundReport
        fundMembers={fundMembersWithBalances}
        transactions={transactions}
      />
      <FundTransactionLog transactions={txRows} />
      <ReconcilePanel />
    </div>
  );
}

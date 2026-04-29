import Link from "next/link";
import { ArrowRight, Receipt } from "lucide-react";
import { getTranslations } from "next-intl/server";
import {
  getFundMembersWithBalances,
  getAllFundTransactions,
  getFundOverview,
} from "@/actions/fund";
import { mergeLegacyDebtsIntoFund } from "@/actions/merge-debt-fund";
import { db } from "@/db";
import { members } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FundDashboard } from "./fund-dashboard";
import { FundReport } from "./fund-report";
import { ReconcilePanel } from "./reconcile-panel";

export default async function AdminFundPage() {
  // One-shot, idempotent: collapse any legacy unpaid session debts into the
  // unified fund balance. Cheap when there's nothing to migrate.
  await mergeLegacyDebtsIntoFund();

  const [overview, fundMembersWithBalances, transactions, allMembers, t] =
    await Promise.all([
      getFundOverview(),
      getFundMembersWithBalances(),
      getAllFundTransactions(),
      db.query.members.findMany({ where: eq(members.isActive, true) }),
      getTranslations("fundAdmin"),
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

      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 text-primary rounded-full p-2.5">
              <Receipt className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold">
                {t("transactionsCardTitle")}
              </h3>
              <p className="text-muted-foreground text-sm">
                {t("transactionsCardSubtitle")}
              </p>
            </div>
          </div>
          <Link href="/admin/fund/transactions">
            <Button variant="outline" size="sm">
              {t("transactionsCardCta")}
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </Link>
        </CardContent>
      </Card>

      <ReconcilePanel />
    </div>
  );
}

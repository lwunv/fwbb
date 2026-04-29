import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getRecentFinancialTransactions } from "@/actions/fund";
import { Button } from "@/components/ui/button";
import { FundTransactionLog } from "../fund-transaction-log";

export default async function AdminFundTransactionsPage() {
  // Wider window than the fund landing card. The list is virtualized via
  // framer-motion AnimatePresence (cheap), so 500 rows is fine on mobile.
  const [recentFinancialTransactions, t] = await Promise.all([
    getRecentFinancialTransactions(500),
    getTranslations("fundAdmin"),
  ]);

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
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/admin/fund">
          <Button variant="ghost" size="icon" aria-label={t("backToFund")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-lg font-bold">{t("transactionsPageTitle")}</h1>
      </div>

      <FundTransactionLog transactions={txRows} />
    </div>
  );
}

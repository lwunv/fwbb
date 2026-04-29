import { getTranslations } from "next-intl/server";
import { getUserFromCookie } from "@/lib/user-identity";
import { getFundTransactionsForMember } from "@/actions/fund";
import { getFundBalance } from "@/lib/fund-calculator";
import { MyFundClient } from "./my-fund-client";

export default async function MyFundPage() {
  const [user, t] = await Promise.all([
    getUserFromCookie(),
    getTranslations("myFundPage"),
  ]);

  if (!user) {
    return (
      <div className="text-muted-foreground py-16 text-center">
        {t("identifyFirst")}
      </div>
    );
  }

  const [balance, transactions] = await Promise.all([
    getFundBalance(user.memberId),
    getFundTransactionsForMember(user.memberId),
  ]);

  return (
    <MyFundClient
      balance={balance}
      transactions={transactions}
      memberId={user.memberId}
    />
  );
}

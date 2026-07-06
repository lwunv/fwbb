import { redirect } from "next/navigation";
import { getUserFromCookie } from "@/lib/user-identity";
import { getFundTransactionsForMember } from "@/actions/fund";
import { getFundBalance } from "@/lib/fund-calculator";
import { MyFundClient } from "./my-fund-client";

export default async function MyFundPage() {
  const user = await getUserFromCookie();
  // Chỉ trang chủ public; quỹ cá nhân vẫn cần đăng nhập.
  if (!user) redirect("/login");

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

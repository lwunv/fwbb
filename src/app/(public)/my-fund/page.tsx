import { getUserFromCookie } from "@/lib/user-identity";
import { getFundTransactionsForMember } from "@/actions/fund";
import { getFundBalance } from "@/lib/fund-calculator";
import { isFundMember } from "@/lib/fund-calculator";
import { MyFundClient } from "./my-fund-client";

export default async function MyFundPage() {
  const user = await getUserFromCookie();

  if (!user) {
    return (
      <div className="text-muted-foreground py-16 text-center">
        Vui lòng xác định danh tính trước.
      </div>
    );
  }

  const isInFund = await isFundMember(user.memberId);

  if (!isInFund) {
    return (
      <div className="mx-auto max-w-lg space-y-3 py-16 text-center">
        <div className="text-4xl">💰</div>
        <h2 className="text-lg font-semibold">Bạn chưa tham gia quỹ nhóm</h2>
        <p className="text-muted-foreground text-sm">
          Liên hệ admin để được thêm vào quỹ.
        </p>
      </div>
    );
  }

  const [balance, transactions] = await Promise.all([
    getFundBalance(user.memberId),
    getFundTransactionsForMember(user.memberId),
  ]);

  return <MyFundClient balance={balance} transactions={transactions} />;
}

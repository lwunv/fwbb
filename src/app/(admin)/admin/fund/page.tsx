import {
  getFundMembersWithBalances,
  getAllFundTransactions,
  getFundOverview,
} from "@/actions/fund";
import { db } from "@/db";
import { members } from "@/db/schema";
import { eq } from "drizzle-orm";
import { FundDashboard } from "./fund-dashboard";

export default async function AdminFundPage() {
  const [overview, fundMembersWithBalances, transactions, allMembers] =
    await Promise.all([
      getFundOverview(),
      getFundMembersWithBalances(),
      getAllFundTransactions(),
      db.query.members.findMany({ where: eq(members.isActive, true) }),
    ]);

  return (
    <FundDashboard
      overview={overview}
      fundMembers={fundMembersWithBalances}
      transactions={transactions}
      allMembers={allMembers}
    />
  );
}

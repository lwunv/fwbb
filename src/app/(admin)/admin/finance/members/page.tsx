import { getMemberFinanceOverview } from "@/actions/finance";
import { MemberFinanceClient } from "./member-finance-client";

export default async function AdminMemberFinancePage() {
  const rows = await getMemberFinanceOverview();
  return <MemberFinanceClient rows={rows} />;
}

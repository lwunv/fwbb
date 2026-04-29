import {
  getShuttlecockFinanceSummary,
  getPurchaseHistory,
  getUsageHistory,
} from "@/actions/shuttlecock-finance";
import { ShuttlecockFinanceClient } from "./shuttlecock-finance-client";

export default async function AdminShuttlecockFinancePage() {
  const [summary, purchases, usages] = await Promise.all([
    getShuttlecockFinanceSummary(),
    getPurchaseHistory(100),
    getUsageHistory(100),
  ]);

  return (
    <ShuttlecockFinanceClient
      summary={summary}
      purchases={purchases}
      usages={usages}
    />
  );
}

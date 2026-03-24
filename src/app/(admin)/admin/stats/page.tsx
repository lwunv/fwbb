import {
  getActiveMembersStats,
  getMonthlyExpenses,
  getAttendanceTrend,
} from "@/actions/stats";
import { StatsClient } from "./stats-client";

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; expenseGroup?: string }>;
}) {
  const { period = "all", expenseGroup = "month" } = await searchParams;

  const [activeMembers, monthlyExpenses, attendance] = await Promise.all([
    getActiveMembersStats(period),
    getMonthlyExpenses(period, expenseGroup),
    getAttendanceTrend(period),
  ]);

  return (
    <div className="space-y-6">
      <StatsClient
        activeMembers={activeMembers}
        monthlyExpenses={monthlyExpenses}
        attendance={attendance}
        expenseGroup={expenseGroup}
      />
    </div>
  );
}

import {
  getActiveMembersStats,
  getMonthlyExpenses,
  getAttendanceTrend,
  getAvailableYears,
} from "@/actions/stats";
import { StatsClient } from "./stats-client";

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ activeYear?: string; expenseGroup?: string }>;
}) {
  const { activeYear = "all", expenseGroup = "week" } = await searchParams;

  const [activeMembers, monthlyExpenses, attendance, availableYears] =
    await Promise.all([
      getActiveMembersStats(activeYear),
      getMonthlyExpenses(expenseGroup),
      getAttendanceTrend(),
      getAvailableYears(),
    ]);

  return (
    <div className="space-y-6">
      <StatsClient
        activeMembers={activeMembers}
        monthlyExpenses={monthlyExpenses}
        attendance={attendance}
        expenseGroup={expenseGroup}
        activeYear={activeYear}
        availableYears={availableYears}
      />
    </div>
  );
}

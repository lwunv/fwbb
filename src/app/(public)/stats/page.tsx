import {
  getActiveMembersStats,
  getMonthlyExpenses,
  getAttendanceTrend,
} from "@/actions/stats";
import { StatsClient } from "@/app/(admin)/admin/stats/stats-client";

export default async function PublicStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period = "all" } = await searchParams;

  const [activeMembers, monthlyExpenses, attendance] = await Promise.all([
    getActiveMembersStats(period),
    getMonthlyExpenses(period),
    getAttendanceTrend(period),
  ]);

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <h1 className="text-lg font-bold">Thong ke</h1>
      <StatsClient
        activeMembers={activeMembers}
        monthlyExpenses={monthlyExpenses}
        attendance={attendance}
      />
    </div>
  );
}

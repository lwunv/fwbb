import {
  getActiveMembersStats,
  getMonthlyExpenses,
  getAttendanceTrend,
} from "@/actions/stats";
import { StatsClient } from "@/app/(admin)/admin/stats/stats-client";
import { getTranslations } from "next-intl/server";
import { getUserFromCookie } from "@/lib/user-identity";

export default async function PublicStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; expenseGroup?: string }>;
}) {
  const { period = "all", expenseGroup = "week" } = await searchParams;
  const t = await getTranslations("nav");
  const user = await getUserFromCookie();

  const [activeMembers, monthlyExpenses, attendance] = await Promise.all([
    getActiveMembersStats(period),
    getMonthlyExpenses(period, expenseGroup, user?.memberId ?? null),
    getAttendanceTrend(),
  ]);

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <StatsClient
        activeMembers={activeMembers}
        monthlyExpenses={monthlyExpenses}
        attendance={attendance}
        expenseGroup={expenseGroup}
      />
    </div>
  );
}

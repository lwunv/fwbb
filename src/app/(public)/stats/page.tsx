import {
  getActiveMembersStats,
  getMonthlyExpenses,
  getAttendanceTrend,
} from "@/actions/stats";
import { StatsClient } from "@/app/(admin)/admin/stats/stats-client";
import { getTranslations } from "next-intl/server";

export default async function PublicStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; expenseGroup?: string }>;
}) {
  const { period = "all", expenseGroup = "month" } = await searchParams;
  const t = await getTranslations("nav");

  const [activeMembers, monthlyExpenses, attendance] = await Promise.all([
    getActiveMembersStats(period),
    getMonthlyExpenses(period, expenseGroup),
    getAttendanceTrend(period),
  ]);

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <h1 className="text-lg font-bold">{t("stats")}</h1>
      <StatsClient
        activeMembers={activeMembers}
        monthlyExpenses={monthlyExpenses}
        attendance={attendance}
        expenseGroup={expenseGroup}
      />
    </div>
  );
}

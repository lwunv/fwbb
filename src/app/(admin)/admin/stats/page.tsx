import {
  getActiveMembersStats,
  getMonthlyExpenses,
  getAttendanceTrend,
} from "@/actions/stats";
import { getTranslations } from "next-intl/server";
import { StatsClient } from "./stats-client";

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period = "all" } = await searchParams;
  const t = await getTranslations("adminNav");

  const [activeMembers, monthlyExpenses, attendance] = await Promise.all([
    getActiveMembersStats(period),
    getMonthlyExpenses(period),
    getAttendanceTrend(period),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("stats")}</h1>
      <StatsClient
        activeMembers={activeMembers}
        monthlyExpenses={monthlyExpenses}
        attendance={attendance}
      />
    </div>
  );
}

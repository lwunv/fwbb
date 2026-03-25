"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ActiveMembersChart } from "@/components/stats/active-members-chart";
import { MonthlyExpensesChart } from "@/components/stats/monthly-expenses-chart";
import { AttendanceChart } from "@/components/stats/attendance-chart";
import type { ActiveMemberStat, MonthlyExpense, AttendancePoint } from "@/actions/stats";
import { usePolling } from "@/lib/use-polling";

interface StatsClientProps {
  activeMembers: ActiveMemberStat[];
  monthlyExpenses: MonthlyExpense[];
  attendance: AttendancePoint[];
  expenseGroup?: string;
}

export function StatsClient({
  activeMembers,
  monthlyExpenses,
  attendance,
  expenseGroup = "week",
}: StatsClientProps) {
  const t = useTranslations("stats");
  usePolling();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("activeMembers")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ActiveMembersChart data={activeMembers} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("monthlyCost")}</CardTitle>
        </CardHeader>
        <CardContent>
          <MonthlyExpensesChart data={monthlyExpenses} groupBy={expenseGroup} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("attendanceTrend")}</CardTitle>
        </CardHeader>
        <CardContent>
          <AttendanceChart data={attendance} />
        </CardContent>
      </Card>
    </div>
  );
}

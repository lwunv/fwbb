"use client";

import { NuqsAdapter } from "nuqs/adapters/next/app";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TimeFilter } from "@/components/shared/time-filter";
import { ActiveMembersChart } from "@/components/stats/active-members-chart";
import { MonthlyExpensesChart } from "@/components/stats/monthly-expenses-chart";
import { AttendanceChart } from "@/components/stats/attendance-chart";
import type { ActiveMemberStat, MonthlyExpense, AttendancePoint } from "@/actions/stats";

interface StatsClientProps {
  activeMembers: ActiveMemberStat[];
  monthlyExpenses: MonthlyExpense[];
  attendance: AttendancePoint[];
}

export function StatsClient({
  activeMembers,
  monthlyExpenses,
  attendance,
}: StatsClientProps) {
  const t = useTranslations("stats");

  return (
    <NuqsAdapter>
      <div className="space-y-6">
        <TimeFilter />

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
            <MonthlyExpensesChart data={monthlyExpenses} />
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
    </NuqsAdapter>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ActiveMembersChart } from "@/components/stats/active-members-chart";
import { MonthlyExpensesChart } from "@/components/stats/monthly-expenses-chart";
import { AttendanceChart } from "@/components/stats/attendance-chart";
import type {
  ActiveMemberStat,
  MonthlyExpense,
  AttendancePoint,
} from "@/actions/stats";
import { usePolling } from "@/lib/use-polling";

interface StatsClientProps {
  activeMembers: ActiveMemberStat[];
  monthlyExpenses: MonthlyExpense[];
  attendance: AttendancePoint[];
  expenseGroup?: string;
}

const GROUP_OPTIONS = ["session", "week", "month", "year"] as const;

export function StatsClient({
  activeMembers,
  monthlyExpenses,
  attendance,
  expenseGroup = "week",
}: StatsClientProps) {
  const t = useTranslations("stats");
  const router = useRouter();
  const searchParams = useSearchParams();
  usePolling();

  const groupLabels: Record<string, string> = {
    session: t("perSession"),
    week: t("perWeek"),
    month: t("perMonth"),
    year: t("perYear"),
  };

  function handleGroupChange(group: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("expenseGroup", group);
    // Đồng bộ period cho 2 chart còn lại (session→all)
    params.set("period", group === "session" ? "all" : group);
    router.push(`?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="space-y-4">
      {/* Filter chung — áp cho cả 3 biểu đồ */}
      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="bg-muted flex gap-1 rounded-lg p-1">
            {GROUP_OPTIONS.map((g) => (
              <button
                key={g}
                onClick={() => handleGroupChange(g)}
                className={`flex-1 rounded-md px-2 py-2 text-sm font-medium transition-colors ${
                  expenseGroup === g
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {groupLabels[g]}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

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

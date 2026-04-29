"use client";

import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CustomSelect } from "@/components/ui/custom-select";
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
  expenseGroup: string;
  activeYear: string;
  availableYears: string[];
}

const GROUP_OPTIONS = ["session", "week", "month", "year"] as const;

export function StatsClient({
  activeMembers,
  monthlyExpenses,
  attendance,
  expenseGroup,
  activeYear,
  availableYears,
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

  const yearOptions = [
    { value: "all", label: t("allYears") },
    ...availableYears.map((y) => ({ value: y, label: y })),
  ];

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set(key, value);
    router.push(`?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("activeMembers")}</CardTitle>
          <CardAction>
            <CustomSelect
              options={yearOptions}
              value={activeYear}
              onChange={(v) => setParam("activeYear", v)}
              className="w-36"
            />
          </CardAction>
        </CardHeader>
        <CardContent>
          <ActiveMembersChart data={activeMembers} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("monthlyCost")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted flex gap-1 rounded-lg p-1">
            {GROUP_OPTIONS.map((g) => (
              <button
                key={g}
                onClick={() => setParam("expenseGroup", g)}
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

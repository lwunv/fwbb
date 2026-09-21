"use client";

import { useEffect, useState, useTransition } from "react";
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
import { cn } from "@/lib/utils";

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

  // Hai control dưới đây đổi dữ liệu bằng `router.push`, tức là phải chờ server
  // trả về slice mới. Nếu chúng lấy value THẲNG từ prop server thì bấm xong
  // chúng đứng im cho tới khi request về, nhìn như bấm hụt — đúng lỗi đã gặp ở
  // trang buổi chơi. Giữ bản nháp cục bộ đổi NGAY, rồi `useEffect` kéo về đúng
  // prop khi server trả lời (kể cả khi user bấm Back).
  const [isSwitching, startSwitch] = useTransition();
  const [draftYear, setDraftYear] = useState(activeYear);
  const [draftGroup, setDraftGroup] = useState(expenseGroup);
  useEffect(() => {
    setDraftYear(activeYear);
  }, [activeYear]);
  useEffect(() => {
    setDraftGroup(expenseGroup);
  }, [expenseGroup]);

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set(key, value);
    startSwitch(() => {
      router.push(`?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("activeMembers")}</CardTitle>
          <CardAction>
            <CustomSelect
              options={yearOptions}
              value={draftYear}
              onChange={(v) => {
                setDraftYear(v);
                setParam("activeYear", v);
              }}
              className="w-36"
            />
          </CardAction>
        </CardHeader>
        <CardContent>
          {/* Làm mờ phần DỮ LIỆU trong lúc chờ server, KHÔNG làm mờ control:
              control đã đổi ngay theo bản nháp nên người dùng thấy rõ lựa chọn
              đã ăn và dữ liệu đang về. */}
          <div
            aria-busy={isSwitching}
            className={cn(
              "transition-opacity duration-150",
              isSwitching && "pointer-events-none opacity-50",
            )}
          >
            <ActiveMembersChart data={activeMembers} />
          </div>
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
                onClick={() => {
                  setDraftGroup(g);
                  setParam("expenseGroup", g);
                }}
                className={`flex min-h-11 flex-1 items-center justify-center rounded-md px-2 py-2 text-sm font-medium transition-colors ${
                  draftGroup === g
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

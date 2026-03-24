"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { formatVND } from "@/lib/utils";
import type { MonthlyExpense } from "@/actions/stats";

interface MonthlyExpensesChartProps {
  data: MonthlyExpense[];
  groupBy: string;
}

const GROUP_OPTIONS = ["session", "week", "month", "year"] as const;

function formatLabel(key: string, group: string): string {
  switch (group) {
    case "session": {
      const parts = key.split("-");
      return `${parts[2]}/${parts[1]}`;
    }
    case "week": {
      const parts = key.split("-");
      return `W${parts[2]}/${parts[1]}`;
    }
    case "year":
      return key;
    case "month":
    default: {
      const [year, m] = key.split("-");
      return `T${parseInt(m)}/${year.slice(2)}`;
    }
  }
}

export function MonthlyExpensesChart({ data, groupBy }: MonthlyExpensesChartProps) {
  const t = useTranslations("stats");
  const router = useRouter();
  const searchParams = useSearchParams();

  const groupLabels: Record<string, string> = {
    session: t("perSession"),
    week: t("perWeek"),
    month: t("perMonth"),
    year: t("perYear"),
  };

  function handleGroupChange(group: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("expenseGroup", group);
    router.push(`?${params.toString()}`);
  }

  const chartData = data.map((item) => ({
    ...item,
    label: formatLabel(item.month, groupBy),
  }));

  const labels: Record<string, string> = {
    courtCost: t("court"),
    shuttlecockCost: t("shuttlecock"),
    diningCost: t("diningCost"),
  };

  return (
    <div className="space-y-3">
      {/* Group filter */}
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {GROUP_OPTIONS.map((g) => (
          <button
            key={g}
            onClick={() => handleGroupChange(g)}
            className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
              groupBy === g
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {groupLabels[g]}
          </button>
        ))}
      </div>

      {chartData.length === 0 ? (
        <div className="flex items-center justify-center h-[300px] text-muted-foreground text-sm">
          {t("noData")}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={350}>
          <BarChart
            data={chartData}
            margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis
              tickFormatter={(v) => {
                if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
                if (v >= 1000) return `${(v / 1000).toFixed(0)}k`;
                return String(v);
              }}
              tick={{ fontSize: 11 }}
              width={50}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--color-popover, #fff)",
                border: "1px solid var(--color-border, #e2e8f0)",
                borderRadius: "8px",
                color: "var(--color-popover-foreground, #1e293b)",
              }}
              formatter={(value, name) => [formatVND(Number(value)), labels[String(name)] || String(name)]}
            />
            <Legend formatter={(value: string) => labels[value] || value} />
            <Bar dataKey="courtCost" stackId="a" fill="var(--color-chart-1, #6366f1)" />
            <Bar dataKey="shuttlecockCost" stackId="a" fill="var(--color-chart-2, #8b5cf6)" />
            <Bar dataKey="diningCost" stackId="a" fill="var(--color-chart-3, #10b981)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

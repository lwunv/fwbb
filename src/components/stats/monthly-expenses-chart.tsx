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
import { formatVND } from "@/lib/utils";
import type { MonthlyExpense } from "@/actions/stats";

interface MonthlyExpensesChartProps {
  data: MonthlyExpense[];
}

function formatMonth(month: string): string {
  const [year, m] = month.split("-");
  return `T${parseInt(m)}/${year.slice(2)}`;
}

export function MonthlyExpensesChart({ data }: MonthlyExpensesChartProps) {
  const t = useTranslations("stats");

  const chartData = data.map((item) => ({
    ...item,
    label: formatMonth(item.month),
  }));

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px] text-muted-foreground text-sm">
        {t("noData")}
      </div>
    );
  }

  const labels: Record<string, string> = {
    courtCost: t("court"),
    shuttlecockCost: t("shuttlecock"),
    diningCost: t("diningCost"),
  };

  return (
    <ResponsiveContainer width="100%" height={350}>
      <BarChart
        data={chartData}
        margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
      >
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11 }}
        />
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
          formatter={(value, name) => {
            return [formatVND(Number(value)), labels[String(name)] || String(name)];
          }}
          labelFormatter={(label) => t("monthLabel", { label: String(label) })}
        />
        <Legend
          formatter={(value: string) => {
            return labels[value] || value;
          }}
        />
        <Bar
          dataKey="courtCost"
          stackId="a"
          fill="var(--color-chart-1, #6366f1)"
          radius={[0, 0, 0, 0]}
        />
        <Bar
          dataKey="shuttlecockCost"
          stackId="a"
          fill="var(--color-chart-2, #8b5cf6)"
          radius={[0, 0, 0, 0]}
        />
        <Bar
          dataKey="diningCost"
          stackId="a"
          fill="var(--color-chart-3, #10b981)"
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

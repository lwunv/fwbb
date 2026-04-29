"use client";

import { useState } from "react";
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
import { formatK } from "@/lib/utils";
import type { MonthlyExpense } from "@/actions/stats";

interface MonthlyExpensesChartProps {
  data: MonthlyExpense[];
  groupBy: string;
}

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

export function MonthlyExpensesChart({
  data,
  groupBy,
}: MonthlyExpensesChartProps) {
  const t = useTranslations("stats");
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  function toggleSeries(dataKey: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(dataKey)) next.delete(dataKey);
      else next.add(dataKey);
      return next;
    });
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
      {chartData.length === 0 ? (
        <div className="text-muted-foreground flex h-[300px] items-center justify-center text-sm">
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
              formatter={(value, name) => [
                formatK(Number(value)),
                labels[String(name)] || String(name),
              ]}
            />
            <Legend
              onClick={(e) => {
                if (e.dataKey) toggleSeries(String(e.dataKey));
              }}
              formatter={(value: string) => {
                const isHidden = hidden.has(value);
                return (
                  <span
                    style={{
                      color: isHidden ? "#999" : undefined,
                      textDecoration: isHidden ? "line-through" : undefined,
                      cursor: "pointer",
                    }}
                  >
                    {labels[value] || value}
                  </span>
                );
              }}
            />
            <Bar
              dataKey="courtCost"
              stackId="a"
              fill="var(--color-chart-1, #6366f1)"
              hide={hidden.has("courtCost")}
            />
            <Bar
              dataKey="shuttlecockCost"
              stackId="a"
              fill="var(--color-chart-2, #8b5cf6)"
              hide={hidden.has("shuttlecockCost")}
            />
            <Bar
              dataKey="diningCost"
              stackId="a"
              fill="var(--color-chart-3, #10b981)"
              radius={[4, 4, 0, 0]}
              hide={hidden.has("diningCost")}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

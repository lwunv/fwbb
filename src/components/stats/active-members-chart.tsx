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
  Cell,
} from "recharts";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { ActiveMemberStat } from "@/actions/stats";

type ViewMode = "play" | "dine" | "both";

interface ActiveMembersChartProps {
  data: ActiveMemberStat[];
}

const CHART_COLORS = [
  "var(--color-chart-1, #6366f1)",
  "var(--color-chart-2, #8b5cf6)",
  "var(--color-chart-3, #a78bfa)",
  "var(--color-chart-4, #c4b5fd)",
  "var(--color-chart-5, #ddd6fe)",
];

const DISPLAY_NAME_MAX = 11;

function shortenName(name: string, max = DISPLAY_NAME_MAX) {
  const t = name.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function ActiveMembersChart({ data }: ActiveMembersChartProps) {
  const [mode, setMode] = useState<ViewMode>("play");
  const t = useTranslations("stats");

  const viewLabels: Record<ViewMode, string> = {
    play: t("playBadminton"),
    dine: t("dining"),
    both: t("both"),
  };

  const getValue = (item: ActiveMemberStat) => {
    switch (mode) {
      case "play":
        return item.playCount;
      case "dine":
        return item.dineCount;
      case "both":
        return item.bothCount;
    }
  };

  const chartData = [...data]
    .sort((a, b) => getValue(b) - getValue(a))
    .slice(0, 10)
    .map((item) => ({
      memberName: item.memberName,
      displayName: shortenName(item.memberName),
      value: getValue(item),
    }));

  return (
    <div className="space-y-4">
      <div className="bg-muted flex w-fit gap-1 rounded-lg p-1">
        {(Object.entries(viewLabels) as [ViewMode, string][]).map(
          ([key, label]) => (
            <button
              key={key}
              onClick={() => setMode(key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                mode === key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ),
        )}
      </div>

      {chartData.length === 0 ? (
        <div className="text-muted-foreground flex h-[300px] items-center justify-center text-sm">
          {t("noData")}
        </div>
      ) : (
        <ResponsiveContainer
          width="100%"
          height={Math.max(300, chartData.length * 44)}
        >
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 8, right: 16, left: 4, bottom: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              allowDecimals={false}
              tick={{ fontSize: 11 }}
            />
            <YAxis
              type="category"
              dataKey="displayName"
              width={58}
              interval={0}
              tick={(props: {
                x: number | string;
                y: number | string;
                payload: { value: string };
              }) => {
                const x = Number(props.x);
                const y = Number(props.y);
                const { payload } = props;
                return (
                  <g transform={`translate(${x},${y})`}>
                    <text
                      textAnchor="end"
                      fill="var(--muted-foreground)"
                      fontSize={10}
                      transform="rotate(-42)"
                      dx={-2}
                      dy={3}
                    >
                      {payload.value}
                    </text>
                  </g>
                );
              }}
            />
            <Tooltip
              cursor={{
                fill: "var(--color-foreground, #0f172a)",
                fillOpacity: 0.06,
              }}
              contentStyle={{
                backgroundColor: "var(--color-popover, #fff)",
                border: "1px solid var(--color-border, #e2e8f0)",
                borderRadius: "12px",
                color: "var(--color-popover-foreground, #1e293b)",
                boxShadow: "0 8px 24px -8px rgba(0,0,0,0.25)",
                padding: "10px 12px",
                fontSize: 12,
              }}
              itemStyle={{ padding: "2px 0" }}
              labelFormatter={(_, payload) =>
                (payload?.[0]?.payload as { memberName?: string })
                  ?.memberName ?? ""
              }
              formatter={(value) => [
                `${value} ${t("sessionsUnit")}`,
                viewLabels[mode],
              ]}
            />
            <Bar
              dataKey="value"
              radius={[0, 4, 4, 0]}
              activeBar={{
                stroke: "var(--color-foreground, #0f172a)",
                strokeOpacity: 0.35,
                strokeWidth: 1,
              }}
            >
              {chartData.map((_, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={CHART_COLORS[index % CHART_COLORS.length]}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

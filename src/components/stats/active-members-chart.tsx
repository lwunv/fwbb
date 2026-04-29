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
import type { ActiveMemberStat } from "@/actions/stats";

interface ActiveMembersChartProps {
  data: ActiveMemberStat[];
}

const COLOR_PLAY = "var(--color-primary, #6366f1)";
const COLOR_DINE = "#f97316"; // orange-500, matches dining accent on home/session cards

const DISPLAY_NAME_MAX = 11;

function shortenName(name: string, max = DISPLAY_NAME_MAX) {
  const t = name.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function ActiveMembersChart({ data }: ActiveMembersChartProps) {
  const t = useTranslations("stats");

  const seriesLabels: Record<string, string> = {
    playCount: t("playBadminton"),
    dineCount: t("dining"),
  };

  const chartData = [...data]
    .sort((a, b) => b.playCount + b.dineCount - (a.playCount + a.dineCount))
    .slice(0, 10)
    .map((item) => ({
      memberName: item.memberName,
      displayName: shortenName(item.memberName),
      playCount: item.playCount,
      dineCount: item.dineCount,
    }));

  return (
    <div className="space-y-4">
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
                color: "var(--color-popover-foreground, #f8fafc)",
                boxShadow: "0 8px 24px -8px rgba(0,0,0,0.25)",
                padding: "10px 12px",
                fontSize: 12,
              }}
              labelStyle={{
                color: "var(--color-popover-foreground, #f8fafc)",
                fontWeight: 600,
                marginBottom: 4,
              }}
              itemStyle={{
                color: "var(--color-popover-foreground, #f8fafc)",
                padding: "2px 0",
              }}
              labelFormatter={(_, payload) =>
                (payload?.[0]?.payload as { memberName?: string })
                  ?.memberName ?? ""
              }
              formatter={(value, name) => [
                `${value} ${t("sessionsUnit")}`,
                seriesLabels[String(name)] ?? String(name),
              ]}
            />
            <Legend
              formatter={(value: string) => (
                <span className="text-muted-foreground text-xs">
                  {seriesLabels[value] ?? value}
                </span>
              )}
            />
            <Bar
              dataKey="playCount"
              stackId="a"
              fill={COLOR_PLAY}
              activeBar={{
                stroke: "var(--color-foreground, #0f172a)",
                strokeOpacity: 0.35,
                strokeWidth: 1,
              }}
            />
            <Bar
              dataKey="dineCount"
              stackId="a"
              fill={COLOR_DINE}
              radius={[0, 4, 4, 0]}
              activeBar={{
                stroke: "var(--color-foreground, #0f172a)",
                strokeOpacity: 0.35,
                strokeWidth: 1,
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

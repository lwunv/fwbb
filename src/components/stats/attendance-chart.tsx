"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { useTranslations } from "next-intl";
import type { AttendancePoint } from "@/actions/stats";

interface AttendanceChartProps {
  data: AttendancePoint[];
}

function formatDate(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${parseInt(d)}/${parseInt(m)}`;
}

export function AttendanceChart({ data }: AttendanceChartProps) {
  const t = useTranslations("stats");

  const chartData = data.map((item) => ({
    ...item,
    label: formatDate(item.date),
  }));

  const avgPlayers =
    chartData.length > 0
      ? Math.round(
          chartData.reduce((sum, d) => sum + d.playerCount, 0) /
            chartData.length,
        )
      : 0;

  if (chartData.length === 0) {
    return (
      <div className="text-muted-foreground flex h-[300px] items-center justify-center text-sm">
        {t("noData")}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-muted-foreground text-xs">
        {t("average")}: {avgPlayers} {t("peoplePerSession")}
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart
          data={chartData}
          margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11 }}
            interval="preserveStartEnd"
          />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={30} />
          <Tooltip
            cursor={{
              stroke: "var(--color-foreground, #0f172a)",
              strokeOpacity: 0.25,
              strokeDasharray: "3 3",
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
            formatter={(value, name) => {
              const labels: Record<string, string> = {
                playerCount: t("players"),
                dinerCount: t("diners"),
              };
              return [
                `${value} ${t("people")}`,
                labels[String(name)] || String(name),
              ];
            }}
            labelFormatter={(label) => `${t("dateLabel")} ${label}`}
          />
          <ReferenceLine
            y={avgPlayers}
            stroke="var(--color-muted-foreground, #94a3b8)"
            strokeDasharray="3 3"
            label={{
              value: `${t("avgShort")}: ${avgPlayers}`,
              position: "right",
              fontSize: 10,
              fill: "var(--color-muted-foreground, #94a3b8)",
            }}
          />
          <Line
            type="monotone"
            dataKey="playerCount"
            stroke="var(--color-chart-1, #6366f1)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--color-chart-1, #6366f1)" }}
            activeDot={{ r: 5 }}
          />
          <Line
            type="monotone"
            dataKey="dinerCount"
            stroke="var(--color-chart-3, #10b981)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--color-chart-3, #10b981)" }}
            activeDot={{ r: 5 }}
            strokeDasharray="5 5"
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="text-muted-foreground flex justify-center gap-4 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="h-0.5 w-3 bg-[var(--color-chart-1,#6366f1)]" />
          {t("players")}
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="h-0.5 w-3 border-dashed bg-[var(--color-chart-3,#10b981)]"
            style={{
              borderTop: "2px dashed var(--color-chart-3, #10b981)",
              height: 0,
            }}
          />
          {t("diners")}
        </div>
      </div>
    </div>
  );
}

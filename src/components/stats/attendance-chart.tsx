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
import type { AttendancePoint } from "@/actions/stats";

interface AttendanceChartProps {
  data: AttendancePoint[];
}

function formatDate(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${parseInt(d)}/${parseInt(m)}`;
}

export function AttendanceChart({ data }: AttendanceChartProps) {
  const chartData = data.map((item) => ({
    ...item,
    label: formatDate(item.date),
  }));

  const avgPlayers =
    chartData.length > 0
      ? Math.round(
          chartData.reduce((sum, d) => sum + d.playerCount, 0) / chartData.length
        )
      : 0;

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px] text-muted-foreground text-sm">
        Chua co du lieu
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">
        Trung binh: {avgPlayers} nguoi/buoi
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
            contentStyle={{
              backgroundColor: "var(--color-popover, #fff)",
              border: "1px solid var(--color-border, #e2e8f0)",
              borderRadius: "8px",
              color: "var(--color-popover-foreground, #1e293b)",
            }}
            formatter={(value, name) => {
              const labels: Record<string, string> = {
                playerCount: "Nguoi choi",
                dinerCount: "Nguoi an",
              };
              return [`${value} nguoi`, labels[String(name)] || String(name)];
            }}
            labelFormatter={(label) => `Ngay ${label}`}
          />
          <ReferenceLine
            y={avgPlayers}
            stroke="var(--color-muted-foreground, #94a3b8)"
            strokeDasharray="3 3"
            label={{
              value: `TB: ${avgPlayers}`,
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
      <div className="flex gap-4 justify-center text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-0.5 bg-[var(--color-chart-1,#6366f1)]" />
          Nguoi choi
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-0.5 bg-[var(--color-chart-3,#10b981)] border-dashed" style={{ borderTop: "2px dashed var(--color-chart-3, #10b981)", height: 0 }} />
          Nguoi an
        </div>
      </div>
    </div>
  );
}

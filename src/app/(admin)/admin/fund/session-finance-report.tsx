"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { formatK, cn } from "@/lib/utils";
import { ChevronDown, TrendingUp, TrendingDown } from "lucide-react";
import type { SessionFinanceEntry } from "@/actions/fund";

type Granularity = "session" | "week" | "month" | "year" | "all";

interface Aggregate {
  key: string; // e.g., "2026-W19" / "2026-05" / "2026" / "all"
  label: string; // human-readable e.g., "Tuần 19, 2026"
  chi: number;
  thu: number;
  loi: number;
  count: number; // sessions in this bucket
  sessions: SessionFinanceEntry[];
}

function isoWeek(date: string): string {
  // Returns "YYYY-Www" e.g., "2026-W19"
  const d = new Date(date + "T00:00:00Z");
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = d.getTime();
  d.setUTCMonth(0, 1);
  if (d.getUTCDay() !== 4) {
    d.setUTCMonth(0, 1 + ((4 - d.getUTCDay() + 7) % 7));
  }
  const week = 1 + Math.ceil((firstThursday - d.getTime()) / 604800000);
  return `${new Date(date + "T00:00:00Z").getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function bucket(entries: SessionFinanceEntry[], g: Granularity): Aggregate[] {
  if (g === "all") {
    const total = entries.reduce(
      (acc, e) => ({
        chi: acc.chi + e.chi,
        thu: acc.thu + e.thu,
        loi: acc.loi + e.loi,
      }),
      { chi: 0, thu: 0, loi: 0 },
    );
    return [
      {
        key: "all",
        label: "Tất cả thời gian",
        chi: total.chi,
        thu: total.thu,
        loi: total.loi,
        count: entries.length,
        sessions: entries,
      },
    ];
  }

  const groups = new Map<string, SessionFinanceEntry[]>();
  for (const e of entries) {
    let key: string;
    if (g === "session") {
      key = String(e.sessionId);
    } else if (g === "week") {
      key = isoWeek(e.date);
    } else if (g === "month") {
      key = e.date.slice(0, 7); // YYYY-MM
    } else {
      key = e.date.slice(0, 4); // YYYY
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  return Array.from(groups.entries())
    .map(([key, items]) => {
      const chi = items.reduce((s, e) => s + e.chi, 0);
      const thu = items.reduce((s, e) => s + e.thu, 0);
      let label: string;
      if (g === "session") {
        const e = items[0];
        label = `${e.date}${e.courtName ? ` · ${e.courtName}` : ""}`;
      } else if (g === "week") {
        const [year, w] = key.split("-W");
        label = `Tuần ${parseInt(w, 10)}, ${year}`;
      } else if (g === "month") {
        const [year, month] = key.split("-");
        label = `Tháng ${parseInt(month, 10)}/${year}`;
      } else {
        label = `Năm ${key}`;
      }
      return {
        key,
        label,
        chi,
        thu,
        loi: thu - chi,
        count: items.length,
        sessions: items,
      };
    })
    .sort((a, b) => b.key.localeCompare(a.key)); // newest first
}

export function SessionFinanceReport({
  entries,
}: {
  entries: SessionFinanceEntry[];
}) {
  const [g, setG] = useState<Granularity>("month");
  const [expanded, setExpanded] = useState<string | null>(null);

  const buckets = useMemo(() => bucket(entries, g), [entries, g]);
  const totals = useMemo(() => {
    return buckets.reduce(
      (acc, b) => ({
        chi: acc.chi + b.chi,
        thu: acc.thu + b.thu,
        loi: acc.loi + b.loi,
        count: acc.count + b.count,
      }),
      { chi: 0, thu: 0, loi: 0, count: 0 },
    );
  }, [buckets]);

  const tabs: Array<{ key: Granularity; label: string }> = [
    { key: "session", label: "Buổi" },
    { key: "week", label: "Tuần" },
    { key: "month", label: "Tháng" },
    { key: "year", label: "Năm" },
    { key: "all", label: "All-time" },
  ];

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold">Báo cáo Thu/Chi từ buổi chơi</h3>
          {totals.count > 0 && (
            <span className="text-muted-foreground text-xs">
              {totals.count} buổi
            </span>
          )}
        </div>

        {/* Granularity tabs — LUÔN 1 hàng (cuộn ngang nếu hẹp) thay vì wrap
            xuống 2 dòng. scrollbar-none + full-bleed để dải cuộn chạm mép card. */}
        <div className="scrollbar-none -mx-4 flex flex-nowrap gap-1.5 overflow-x-auto px-4">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setG(tab.key)}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center rounded-full border px-3 text-sm font-medium transition-colors",
                g === tab.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground hover:bg-muted/80",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Totals strip */}
        {totals.count > 0 && (
          <div className="grid grid-cols-3 gap-2">
            <Tile label="Tổng chi" amount={totals.chi} color="primary" />
            <Tile label="Tổng thu" amount={totals.thu} color="blue" />
            <Tile
              label="Lãi/Lỗ"
              amount={totals.loi}
              color={totals.loi >= 0 ? "green" : "rose"}
              showSign
            />
          </div>
        )}

        {/* Buckets list */}
        <div className="space-y-2">
          {buckets.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              Chưa có buổi chơi nào hoàn thành.
            </p>
          ) : (
            buckets.map((b) => {
              const isOpen = expanded === b.key;
              const hasChildren = g !== "session" && b.sessions.length > 0;
              return (
                <div
                  key={b.key}
                  className={cn(
                    "overflow-hidden rounded-xl border",
                    b.loi >= 0
                      ? "border-l-4 border-l-green-500/50"
                      : "border-l-4 border-l-rose-500/50",
                  )}
                >
                  <button
                    type="button"
                    onClick={() =>
                      hasChildren && setExpanded(isOpen ? null : b.key)
                    }
                    className={cn(
                      "flex w-full items-center gap-3 p-3 text-left transition-colors",
                      hasChildren ? "hover:bg-muted/40" : "cursor-default",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        {b.loi > 0 ? (
                          <TrendingUp className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
                        ) : b.loi < 0 ? (
                          <TrendingDown className="h-4 w-4 shrink-0 text-rose-500 dark:text-rose-400" />
                        ) : null}
                        <span className="truncate">{b.label}</span>
                        {g !== "session" && (
                          <span className="text-muted-foreground text-xs font-normal">
                            ({b.count} buổi)
                          </span>
                        )}
                      </div>
                      <div className="text-muted-foreground mt-0.5 text-sm tabular-nums">
                        Chi {formatK(b.chi)} · Thu {formatK(b.thu)}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div
                        className={cn(
                          "text-base font-bold tabular-nums",
                          b.loi > 0
                            ? "text-green-600 dark:text-green-400"
                            : b.loi < 0
                              ? "text-rose-500 dark:text-rose-400"
                              : "text-muted-foreground",
                        )}
                      >
                        {b.loi > 0 ? "+" : b.loi < 0 ? "−" : ""}
                        {formatK(Math.abs(b.loi))}
                      </div>
                      <div className="text-muted-foreground text-[10px] tracking-wider uppercase">
                        {b.loi > 0 ? "Lãi" : b.loi < 0 ? "Lỗ" : "Hòa"}
                      </div>
                    </div>
                    {hasChildren && (
                      <ChevronDown
                        className={cn(
                          "text-muted-foreground h-4 w-4 shrink-0 transition-transform",
                          isOpen && "rotate-180",
                        )}
                      />
                    )}
                  </button>

                  {isOpen && hasChildren && (
                    <div className="bg-muted/20 divide-y border-t">
                      {b.sessions.map((s) => (
                        <div
                          key={s.sessionId}
                          className="flex items-center gap-3 px-4 py-2 text-sm"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-medium">{s.date}</div>
                            {s.courtName && (
                              <div className="text-muted-foreground truncate text-xs">
                                {s.courtName}
                              </div>
                            )}
                          </div>
                          <div className="text-muted-foreground shrink-0 text-xs tabular-nums">
                            {formatK(s.chi)} → {formatK(s.thu)}
                          </div>
                          <div
                            className={cn(
                              "min-w-[60px] shrink-0 text-right font-semibold tabular-nums",
                              s.loi > 0
                                ? "text-green-600 dark:text-green-400"
                                : s.loi < 0
                                  ? "text-rose-500 dark:text-rose-400"
                                  : "text-muted-foreground",
                            )}
                          >
                            {s.loi > 0 ? "+" : s.loi < 0 ? "−" : ""}
                            {formatK(Math.abs(s.loi))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Tile({
  label,
  amount,
  color,
  showSign,
}: {
  label: string;
  amount: number;
  color: "primary" | "blue" | "green" | "rose";
  showSign?: boolean;
}) {
  const colorClass = {
    primary: "text-primary",
    blue: "text-blue-600 dark:text-blue-400",
    green: "text-green-600 dark:text-green-400",
    rose: "text-rose-500 dark:text-rose-400",
  }[color];
  const sign = showSign ? (amount > 0 ? "+" : amount < 0 ? "−" : "") : "";
  return (
    <div className="bg-muted/30 rounded-lg border px-3 py-2 text-center">
      <div className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
        {label}
      </div>
      <div className={cn("text-lg font-bold tabular-nums", colorClass)}>
        {sign}
        {formatK(Math.abs(amount))}
      </div>
    </div>
  );
}

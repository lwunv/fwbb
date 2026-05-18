"use client";

import { Check } from "lucide-react";
import { formatK, cn } from "@/lib/utils";

export interface SessionCostStatsProps {
  totalExpense: number;
  playCostPerHead: number;
  dineCostPerHead: number;
  /** null = revenue chưa biết (voting / confirmed future). Hiện placeholder. */
  revenue: number | null;
  /** "actual" = revenue đã chốt sổ; "predicted" = ước lượng từ vote count. */
  revenueLabel?: "actual" | "predicted";
  /** Hiện button "Xác nhận buổi chơi" full-width dưới grid khi canFinalize. */
  canFinalize?: boolean;
  isFinalizing?: boolean;
  onFinalize?: () => void;
  /** i18n labels — caller pass từ useTranslations để tránh client/server boundary. */
  confirmLabel?: string;
  confirmingLabel?: string;
}

/**
 * Shared 2-card stat block "Tổng chi / Tổng thu + Lãi-Lỗ" cho cả
 * /admin/sessions list và /admin/dashboard upcoming-session block.
 * Đảm bảo UI nhất quán + 1 nơi sửa.
 *
 * - Card 1 (💰 Tổng chi): total + per-head split
 * - Card 2 (💵 Tổng thu): revenue + Lãi/Lỗ (background đổi theo profit sign)
 *   Khi revenue=null → dashed border placeholder "Chưa chốt sổ"
 * - Optional Xác nhận buổi chơi button
 */
export function SessionCostStats({
  totalExpense,
  playCostPerHead,
  dineCostPerHead,
  revenue,
  revenueLabel = "actual",
  canFinalize = false,
  isFinalizing = false,
  onFinalize,
  confirmLabel = "Xác nhận buổi chơi",
  confirmingLabel = "Đang xác nhận...",
}: SessionCostStatsProps) {
  const profit = revenue !== null ? revenue - totalExpense : null;
  const profitColor =
    profit === null
      ? "text-muted-foreground"
      : profit > 0
        ? "text-green-600 dark:text-green-400"
        : profit < 0
          ? "text-rose-500 dark:text-rose-400"
          : "text-muted-foreground";
  const profitSign =
    profit === null ? "" : profit > 0 ? "+" : profit < 0 ? "−" : "";
  const profitLabel =
    profit === null ? "" : profit > 0 ? "Lãi" : profit < 0 ? "Lỗ" : "Hòa";

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {/* Card 1 — Tổng chi + per-head */}
        <div className="bg-primary/[0.06] border-primary/20 rounded-lg border px-3 py-2">
          <div className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
            💰 Tổng chi
          </div>
          <div className="text-primary text-lg font-bold tabular-nums">
            {formatK(totalExpense)}
          </div>
          {(playCostPerHead > 0 || dineCostPerHead > 0) && (
            <div className="mt-0.5 text-xs tabular-nums">
              {playCostPerHead > 0 && (
                <span className="text-primary font-semibold">
                  🏸 {formatK(playCostPerHead)}
                </span>
              )}
              {playCostPerHead > 0 && dineCostPerHead > 0 && (
                <span className="text-foreground/50"> · </span>
              )}
              {dineCostPerHead > 0 && (
                <span className="font-semibold text-orange-500 dark:text-orange-400">
                  🍻 {formatK(dineCostPerHead)}
                </span>
              )}
              <span className="text-foreground/60 ml-1">/người</span>
            </div>
          )}
        </div>

        {/* Card 2 — Tổng thu + Lãi/Lỗ */}
        {revenue !== null ? (
          <div
            className={cn(
              "rounded-lg border px-3 py-2",
              profit! > 0
                ? "border-green-500/25 bg-green-500/[0.06]"
                : profit! < 0
                  ? "border-rose-500/25 bg-rose-500/[0.06]"
                  : "border-blue-500/25 bg-blue-500/[0.06]",
            )}
          >
            <div className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
              💵 Tổng thu
              {revenueLabel === "predicted" && (
                <span className="ml-1 normal-case">(dự kiến)</span>
              )}
            </div>
            <div className="text-lg font-bold text-blue-600 tabular-nums dark:text-blue-400">
              {formatK(revenue)}
            </div>
            <div
              className={cn(
                "mt-0.5 text-xs font-semibold tabular-nums",
                profitColor,
              )}
            >
              📊 {profitLabel} {profitSign}
              {formatK(Math.abs(profit!))}
            </div>
          </div>
        ) : (
          <div className="border-border/40 bg-muted/30 rounded-lg border border-dashed px-3 py-2">
            <div className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
              💵 Tổng thu
            </div>
            <div className="text-muted-foreground text-lg font-bold tabular-nums">
              —
            </div>
            <div className="text-muted-foreground mt-0.5 text-xs">
              Chưa chốt sổ
            </div>
          </div>
        )}
      </div>

      {/* Confirm button */}
      {canFinalize && onFinalize && (
        <button
          type="button"
          disabled={isFinalizing}
          onClick={(e) => {
            e.stopPropagation();
            onFinalize();
          }}
          className="bg-primary hover:bg-primary/90 active:bg-primary/95 shadow-primary/30 hover:shadow-primary/40 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Check className="h-4 w-4" />
          {isFinalizing ? confirmingLabel : confirmLabel}
        </button>
      )}
    </div>
  );
}

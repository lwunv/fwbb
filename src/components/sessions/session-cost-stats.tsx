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
  /** Optional secondary action (vd nút "Quản lý buổi chơi" trên dashboard).
   *  Hiện cùng hàng với Xác nhận khi có cả 2 (flex-1 cạnh nhau); hiện
   *  full-width khi chỉ có extraAction. */
  extraAction?: React.ReactNode;
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
  extraAction,
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
        <div className="bg-primary/[0.06] border-primary/20 min-w-0 rounded-lg border px-3 py-2">
          <div className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
            💰 Tổng chi
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <div className="text-primary text-2xl font-bold tabular-nums">
              {formatK(totalExpense)}
            </div>
            {(playCostPerHead > 0 || dineCostPerHead > 0) && (
              <div className="text-sm tabular-nums">
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
        </div>

        {/* Card 2 — Tổng thu + Lãi/Lỗ */}
        {revenue !== null ? (
          <div
            className={cn(
              "min-w-0 rounded-lg border px-3 py-2",
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
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <div className="text-2xl font-bold text-blue-600 tabular-nums dark:text-blue-400">
                {formatK(revenue)}
              </div>
              <div
                className={cn(
                  "text-sm font-semibold tabular-nums",
                  profitColor,
                )}
              >
                📊 {profitLabel} {profitSign}
                {formatK(Math.abs(profit!))}
              </div>
            </div>
          </div>
        ) : (
          <div className="border-border/40 bg-muted/30 min-w-0 rounded-lg border border-dashed px-3 py-2">
            <div className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
              💵 Tổng thu
            </div>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <div className="text-muted-foreground text-2xl font-bold tabular-nums">
                —
              </div>
              <div className="text-muted-foreground text-sm">Chưa chốt sổ</div>
            </div>
          </div>
        )}
      </div>

      {/* Action row — Xác nhận + extraAction cùng hàng khi có cả 2,
          ngược lại render cái nào có sẵn full-width. */}
      {(canFinalize && onFinalize) || extraAction ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          {canFinalize && onFinalize && (
            <button
              type="button"
              disabled={isFinalizing}
              onClick={(e) => {
                e.stopPropagation();
                onFinalize();
              }}
              className="bg-primary hover:bg-primary/90 active:bg-primary/95 shadow-primary/30 hover:shadow-primary/40 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-semibold whitespace-nowrap text-white shadow-sm transition-all hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60 sm:flex-1"
            >
              <Check className="h-4 w-4" />
              {isFinalizing ? confirmingLabel : confirmLabel}
            </button>
          )}
          {extraAction && (
            <div className="flex w-full sm:flex-1 [&>*]:w-full">
              {extraAction}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

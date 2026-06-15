"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertCircle,
  AlertTriangle,
  PiggyBank,
  ArrowRight,
  ChevronDown,
} from "lucide-react";
import { formatK, cn } from "@/lib/utils";
import { getFundStatus } from "@/lib/fund-core";
import { FundTopUpCard } from "@/components/finance/fund-topup-card";

/**
 * Banner trên trang chủ thông báo trạng thái quỹ của user theo mô hình
 * Quỹ + Nợ đã gộp:
 *   - balance < 0  → "vẫn còn nợ quỹ"
 *   - balance === 0 → "hết quỹ rồi, nộp thêm đi"
 *   - balance > 0  → không hiển thị
 *
 * Click vào header → expand inline QR ngay tại home, kèm nút "Xem chi tiết"
 * sang /my-fund để nhập số khác hoặc xem lịch sử giao dịch.
 */
export function FundBalanceBanner({
  balance,
  memberId,
}: {
  balance: number;
  /**
   * Optional — nếu thiếu, banner chỉ hiển thị ở dạng cũ (không expand QR).
   * Cần thiết để build memo + render PaymentQR.
   */
  memberId?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const t = useTranslations("fundStatus");

  const status = getFundStatus(balance);
  if (status === "hasFund") return null;

  const isOwing = status === "owing";
  const isLowFund = status === "lowFund";
  const debtAmount = isOwing ? Math.abs(balance) : 0;
  const canExpand = memberId != null;

  const wrapperClass = cn(
    "rounded-xl border transition-colors",
    isOwing
      ? "border-destructive/40 bg-destructive/5"
      : isLowFund
        ? "border-orange-500/40 bg-orange-500/5"
        : "border-amber-500/40 bg-amber-500/5",
  );

  const headerInner = (
    <div className="flex items-start gap-3 p-4">
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
          isOwing
            ? "bg-destructive/15 text-destructive"
            : isLowFund
              ? "bg-orange-500/15 text-orange-600 dark:text-orange-400"
              : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
        )}
      >
        {isOwing ? (
          <AlertCircle className="h-5 w-5" />
        ) : isLowFund ? (
          <AlertTriangle className="h-5 w-5" />
        ) : (
          <PiggyBank className="h-5 w-5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-sm leading-snug font-semibold",
            isOwing
              ? "text-destructive"
              : isLowFund
                ? "text-orange-700 dark:text-orange-300"
                : "text-amber-700 dark:text-amber-300",
          )}
        >
          {isOwing
            ? t("bannerOwing")
            : isLowFund
              ? t("bannerLowFund", { amount: formatK(balance) })
              : t("bannerDepleted")}
        </p>
        {isOwing && (
          <p className="text-destructive mt-1 text-base font-bold tabular-nums">
            {formatK(debtAmount)}
          </p>
        )}
        <p className="text-muted-foreground mt-1 text-xs">
          {canExpand
            ? open
              ? t("tapToClose")
              : t("tapToOpen")
            : t("tapToOpenPage")}
        </p>
      </div>
      {canExpand ? (
        <ChevronDown
          className={cn(
            "text-muted-foreground mt-1 h-4 w-4 shrink-0 transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      ) : (
        <ArrowRight className="text-muted-foreground mt-1 h-4 w-4 shrink-0" />
      )}
    </div>
  );

  if (!canExpand) {
    return (
      <Link
        href="/my-fund"
        className={cn(wrapperClass, "block hover:opacity-90")}
      >
        {headerInner}
      </Link>
    );
  }

  return (
    <div className={wrapperClass}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="block w-full text-left"
        aria-expanded={open}
      >
        {headerInner}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-3 px-4 pb-4">
              <FundTopUpCard
                memberId={memberId!}
                debtAmount={debtAmount}
                bare
              />
              <Link
                href="/my-fund"
                className={cn(
                  "inline-flex w-full items-center justify-center gap-1 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors",
                  isOwing
                    ? "border-destructive/40 text-destructive hover:bg-destructive/10"
                    : isLowFund
                      ? "border-orange-500/40 text-orange-700 hover:bg-orange-500/10 dark:text-orange-300"
                      : "border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300",
                )}
              >
                {t("viewDetail")}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

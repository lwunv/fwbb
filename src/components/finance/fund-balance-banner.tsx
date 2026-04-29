"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, PiggyBank, ArrowRight, ChevronDown } from "lucide-react";
import { formatVND, cn } from "@/lib/utils";
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

  if (balance > 0) return null;

  const isOwing = balance < 0;
  const debtAmount = isOwing ? Math.abs(balance) : 0;
  const canExpand = memberId != null;

  const wrapperClass = cn(
    "rounded-xl border transition-colors",
    isOwing
      ? "border-destructive/40 bg-destructive/5"
      : "border-amber-500/40 bg-amber-500/5",
  );

  const headerInner = (
    <div className="flex items-start gap-3 p-4">
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
          isOwing
            ? "bg-destructive/15 text-destructive"
            : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
        )}
      >
        {isOwing ? (
          <AlertCircle className="h-5 w-5" />
        ) : (
          <PiggyBank className="h-5 w-5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-sm leading-snug font-semibold",
            isOwing ? "text-destructive" : "text-amber-700 dark:text-amber-300",
          )}
        >
          {isOwing
            ? "Bạn ơi, vẫn còn nợ quỹ đấy nhé, nhớ thanh toán sớm!"
            : "Hết quỹ rồi bạn ơi, nộp thêm đi nhé!"}
        </p>
        {isOwing && (
          <p className="text-destructive mt-1 text-base font-bold tabular-nums">
            {formatVND(debtAmount)}
          </p>
        )}
        <p className="text-muted-foreground mt-1 text-xs">
          {canExpand
            ? open
              ? "Bấm lại để đóng QR"
              : "Bấm để mở QR ngay tại đây"
            : "Bấm để mở trang Quỹ và nộp tiền"}
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
                    : "border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300",
                )}
              >
                Xem chi tiết
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

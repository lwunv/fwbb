import Link from "next/link";
import { AlertCircle, PiggyBank, ArrowRight } from "lucide-react";
import { formatVND, cn } from "@/lib/utils";

/**
 * Banner trên trang chủ thông báo trạng thái quỹ của user theo mô hình
 * Quỹ + Nợ đã gộp:
 *   - balance < 0  → "vẫn còn nợ quỹ"
 *   - balance === 0 → "hết quỹ rồi, nộp thêm đi"
 *   - balance > 0  → không hiển thị
 */
export function FundBalanceBanner({ balance }: { balance: number }) {
  if (balance > 0) return null;

  const isOwing = balance < 0;
  const debtAmount = isOwing ? Math.abs(balance) : 0;

  return (
    <Link
      href="/my-fund"
      className={cn(
        "flex items-start gap-3 rounded-xl border p-4 transition-colors",
        isOwing
          ? "border-destructive/40 bg-destructive/5 hover:bg-destructive/10"
          : "border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10",
      )}
    >
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
          Bấm để mở trang Quỹ và nộp tiền
        </p>
      </div>
      <ArrowRight className="text-muted-foreground mt-1 h-4 w-4 shrink-0" />
    </Link>
  );
}

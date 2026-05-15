import { AlertCircle, AlertTriangle, Wallet } from "lucide-react";
import { cn, formatK } from "@/lib/utils";
import { getFundStatus } from "@/lib/fund-core";

/**
 * Small inline icon hiển thị fund-status của 1 member trong rows chật
 * (admin-vote-manager). Render `null` nếu hasFund — không chiếm chỗ.
 *
 * Dùng native `title` attribute → mobile long-press vẫn xem được, không cần
 * Radix tooltip (extra runtime + popper).
 */
export function FundStatusIcon({
  balance,
  size = 14,
  className,
}: {
  balance: number;
  size?: number;
  className?: string;
}) {
  const status = getFundStatus(balance);
  if (status === "hasFund") return null;

  const { Icon, color, title } =
    status === "owing"
      ? {
          Icon: AlertCircle,
          color: "text-rose-500 dark:text-rose-400",
          title: `Nợ ${formatK(-balance)}`,
        }
      : status === "depleted"
        ? {
            Icon: Wallet,
            color: "text-yellow-500 dark:text-yellow-400",
            title: "Hết quỹ",
          }
        : {
            Icon: AlertTriangle,
            color: "text-orange-500 dark:text-orange-400",
            title: `Còn ${formatK(balance)}`,
          };

  return (
    <Icon
      className={cn("shrink-0", color, className)}
      style={{ width: size, height: size } as React.CSSProperties}
      aria-label={title}
      {...({ title } as React.SVGAttributes<SVGSVGElement>)}
    />
  );
}

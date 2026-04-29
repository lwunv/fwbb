import { cn } from "@/lib/utils";
import {
  Check,
  CircleAlert,
  CircleSlash,
  Clock,
  HourglassIcon,
  PackageMinus,
  PackageCheck,
  CheckCircle2,
  Hand,
} from "lucide-react";

export type StatusVariant =
  | "paid"
  | "unpaid"
  | "waiting" // member confirmed, awaiting admin
  | "needsConfirm" // member clicked "đã chuyển khoản", admin chưa xác nhận
  | "partialPaid" // 1 phần đã trả qua quỹ hoặc QR
  | "voting"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "lowStock"
  | "inStock"
  | "neutral";

const VARIANTS: Record<StatusVariant, string> = {
  // "Đã thanh toán" — màu xanh dương
  paid: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300",
  // "Chưa thanh toán" — đỏ
  unpaid: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
  // "Cần xác nhận" — xanh lá (member báo đã CK, admin pending)
  needsConfirm:
    "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300",
  // Legacy waiting — giữ amber để khỏi vỡ chỗ khác
  waiting:
    "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200",
  // "Đã thanh toán 1 phần" — vàng
  partialPaid:
    "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200",
  voting:
    "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300",
  confirmed:
    "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
  completed: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300",
  cancelled:
    "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 line-through",
  lowStock:
    "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300",
  inStock:
    "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
  neutral: "bg-muted text-muted-foreground",
};

interface StatusBadgeProps {
  variant: StatusVariant;
  children: React.ReactNode;
  className?: string;
}

const ICONS: Partial<
  Record<StatusVariant, React.ComponentType<{ className?: string }>>
> = {
  paid: Check,
  unpaid: CircleAlert,
  waiting: HourglassIcon,
  needsConfirm: Hand,
  partialPaid: Clock,
  confirmed: CheckCircle2,
  completed: Check,
  cancelled: CircleSlash,
  lowStock: PackageMinus,
  inStock: PackageCheck,
};

/**
 * Pill badge for session/payment/stock status. Replaces ad-hoc Tailwind class
 * strings duplicated across session-list, finance, dashboard, member-list.
 *
 * Mỗi variant kèm icon riêng để người mù màu hoặc accessibility tools vẫn
 * phân biệt được — không chỉ dựa vào màu nền.
 */
export function StatusBadge({
  variant,
  children,
  className,
}: StatusBadgeProps) {
  const Icon = ICONS[variant];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap",
        VARIANTS[variant],
        className,
      )}
    >
      {variant === "voting" && (
        <span
          aria-hidden
          className="animate-led-dot inline-block h-1.5 w-1.5 rounded-full bg-green-500 dark:bg-green-400"
        />
      )}
      {Icon && <Icon className="h-3 w-3 shrink-0" aria-hidden />}
      {children}
    </span>
  );
}

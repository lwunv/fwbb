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
  | "depleted" // quỹ đã hết — vàng (cảnh báo nhẹ, chưa âm)
  | "neutral";

// Toàn bộ variants thống nhất 1 công thức:
//   light: bg-{hue}-100 text-{hue}-800
//   dark:  bg-{hue}-900/40 text-{hue}-200
// → cùng saturation, cùng độ contrast, chỉ đổi hue. Bỏ line-through trên
//   cancelled (icon CircleSlash + màu đỏ đã đủ semantic). Riêng `neutral`
//   dùng theme tokens vì là default fallback, không có hue cố định.
const VARIANTS: Record<StatusVariant, string> = {
  paid: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  unpaid: "bg-red-200 text-red-900 dark:bg-red-900/50 dark:text-red-100",
  needsConfirm:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  waiting:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  partialPaid:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  voting:
    "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  confirmed:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  completed: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  lowStock:
    "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200",
  inStock:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  depleted:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200",
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

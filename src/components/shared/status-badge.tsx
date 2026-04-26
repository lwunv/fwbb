import { cn } from "@/lib/utils";

export type StatusVariant =
  | "paid"
  | "unpaid"
  | "waiting" // member confirmed, awaiting admin
  | "voting"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "lowStock"
  | "inStock"
  | "neutral";

const VARIANTS: Record<StatusVariant, string> = {
  paid: "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300",
  unpaid: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
  waiting:
    "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200",
  voting: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300",
  confirmed:
    "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
  completed:
    "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300",
  cancelled:
    "bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 line-through",
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

/**
 * Pill badge for session/payment/stock status. Replaces ad-hoc Tailwind class
 * strings duplicated across session-list, finance, dashboard, member-list.
 */
export function StatusBadge({
  variant,
  children,
  className,
}: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap",
        VARIANTS[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type NoticeTone =
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "muted"
  | "primary";

const TONES: Record<NoticeTone, { wrap: string; icon: string }> = {
  info: {
    wrap: "border-blue-200/60 bg-blue-50/60 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200",
    icon: "text-blue-500",
  },
  success: {
    wrap: "border-emerald-200/60 bg-emerald-50/60 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200",
    icon: "text-emerald-500",
  },
  warning: {
    wrap: "border-amber-300/60 bg-amber-50/70 text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-200",
    icon: "text-amber-500",
  },
  danger: {
    wrap: "border-red-200/60 bg-red-50/60 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200",
    icon: "text-red-500",
  },
  muted: {
    wrap: "border-border bg-muted/40 text-muted-foreground",
    icon: "text-muted-foreground",
  },
  primary: {
    wrap: "border-primary/30 bg-primary/5 text-foreground dark:bg-primary/10",
    icon: "text-primary",
  },
};

interface InlineNoticeProps {
  tone?: NoticeTone;
  icon?: LucideIcon;
  children: React.ReactNode;
  /** Optional right-aligned action (e.g. a "View" button). */
  action?: React.ReactNode;
  /** Compact (`px-3 py-2 text-xs`) vs default (`p-4 text-sm`). */
  size?: "sm" | "md";
  className?: string;
}

/**
 * Full-width inline notice / banner. Used for low-stock warnings, overpay
 * alerts, info notes — anywhere we previously hand-rolled
 * `<div class="rounded-lg border border-amber-500/30 bg-amber-500/10 …">`.
 *
 * Tone semantics: info=blue, success=emerald, warning=amber, danger=red,
 * muted=neutral border, primary=brand accent.
 */
export function InlineNotice({
  tone = "info",
  icon: Icon,
  children,
  action,
  size = "md",
  className,
}: InlineNoticeProps) {
  const t = TONES[tone];
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border",
        size === "sm" ? "px-3 py-2 text-xs" : "p-4 text-sm",
        t.wrap,
        className,
      )}
      role="status"
    >
      {Icon && (
        <Icon
          className={cn(
            "shrink-0",
            size === "sm" ? "h-4 w-4" : "h-5 w-5",
            t.icon,
          )}
          aria-hidden
        />
      )}
      <div className="min-w-0 flex-1">{children}</div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

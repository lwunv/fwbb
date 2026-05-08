import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  /**
   * `block` (default) — full empty state with dashed border, used as a top-level
   * placeholder for an entire panel/page section.
   * `inline` — inline empty for use inside an existing card/section. Strips
   * border + reduces padding so it doesn't double-frame.
   */
  variant?: "block" | "inline";
}

/**
 * Empty state for any list that has no data yet. Replaces ad-hoc
 * `<p className="text-muted-foreground py-4 text-center text-sm">…</p>`
 * placeholders sprinkled across pages.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  variant = "block",
}: EmptyStateProps) {
  const isBlock = variant === "block";
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 text-center",
        isBlock
          ? "border-border bg-card/40 rounded-2xl border border-dashed px-6 py-10"
          : "px-4 py-6",
        className,
      )}
    >
      {Icon ? (
        <div
          className={cn(
            "bg-muted text-muted-foreground flex items-center justify-center rounded-full",
            isBlock ? "h-14 w-14" : "h-10 w-10",
          )}
        >
          <Icon className={isBlock ? "h-7 w-7" : "h-5 w-5"} aria-hidden />
        </div>
      ) : null}
      <div className="space-y-1">
        <p
          className={cn(
            "text-foreground font-semibold",
            isBlock ? "text-base" : "text-sm",
          )}
        >
          {title}
        </p>
        {description ? (
          <p
            className={cn(
              "text-muted-foreground",
              isBlock ? "text-sm" : "text-xs",
            )}
          >
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}

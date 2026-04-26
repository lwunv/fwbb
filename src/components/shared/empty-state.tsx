import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

/**
 * Empty state for any list that has no data yet. Replaces ad-hoc
 * `<div>noData</div>` placeholders sprinkled across pages.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "border-border bg-card/40 flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 py-10 text-center",
        className,
      )}
    >
      {Icon ? (
        <div className="bg-muted text-muted-foreground flex h-14 w-14 items-center justify-center rounded-full">
          <Icon className="h-7 w-7" aria-hidden />
        </div>
      ) : null}
      <div className="space-y-1">
        <p className="text-foreground text-base font-semibold">{title}</p>
        {description ? (
          <p className="text-muted-foreground text-sm">{description}</p>
        ) : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}

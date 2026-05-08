import { cn } from "@/lib/utils";

interface InfoRowProps {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Override class on the value (e.g. `"text-emerald-600"`). */
  valueClassName?: string;
  /** Right-aligned badge / sub-meta after the value. */
  badge?: React.ReactNode;
  /**
   * `card` (default) — tile-like row with bg/border, used in lists & summaries.
   * `bare` — no surface, just label/value flex-row, for inline use inside a Card.
   */
  variant?: "card" | "bare";
  className?: string;
}

/**
 * Key-value row used in summaries (cost breakdown, reconcile report,
 * settings list). Replaces hand-rolled
 * `<div className="flex justify-between"><span>{label}</span><strong>{value}</strong></div>`
 * patterns scattered across pages.
 */
export function InfoRow({
  label,
  value,
  valueClassName,
  badge,
  variant = "card",
  className,
}: InfoRowProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 text-sm",
        variant === "card" && "bg-muted/30 rounded-lg border px-3 py-2",
        className,
      )}
    >
      <span className="text-muted-foreground truncate">{label}</span>
      <div className="flex shrink-0 items-center gap-2">
        <strong className={cn("tabular-nums", valueClassName)}>{value}</strong>
        {badge}
      </div>
    </div>
  );
}

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
  /**
   * Let a long value (an address, free-typed opening hours) wrap and align
   * right instead of pushing the row wider than a phone screen. The label
   * keeps its width, capped at 60% of the row. Off by default, so existing
   * rows stay on one line.
   */
  wrapValue?: boolean;
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
  wrapValue = false,
  className,
}: InfoRowProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 text-sm",
        // Label sits on the first line of a wrapped value.
        wrapValue && "items-baseline",
        variant === "card" && "bg-muted/30 rounded-lg border px-3 py-2",
        className,
      )}
    >
      <span
        className={cn(
          "text-muted-foreground truncate",
          wrapValue && "max-w-[60%] shrink-0",
        )}
      >
        {label}
      </span>
      <div
        className={cn(
          "flex items-center gap-2",
          wrapValue ? "min-w-0 flex-1 justify-end" : "shrink-0",
        )}
      >
        <strong
          className={cn(
            "tabular-nums",
            wrapValue && "text-right wrap-anywhere",
            valueClassName,
          )}
        >
          {value}
        </strong>
        {badge}
      </div>
    </div>
  );
}

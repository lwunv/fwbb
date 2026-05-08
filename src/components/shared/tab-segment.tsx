"use client";

import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export interface TabSegmentOption<V extends string = string> {
  value: V;
  label: React.ReactNode;
  icon?: LucideIcon;
  /** Right-aligned counter / badge (e.g. number of items). */
  badge?: React.ReactNode;
}

interface TabSegmentProps<V extends string = string> {
  options: ReadonlyArray<TabSegmentOption<V>>;
  value: V;
  onChange: (value: V) => void;
  /**
   * `pills` — rounded-full chips with active = solid primary (used for filters
   * with horizontal scrolling, e.g. session status filter).
   * `rounded` — rounded-xl tabs with active = elevated bg-background card
   * (used for inline tab switchers, e.g. inventory Stock/Purchases/Usage).
   */
  variant?: "pills" | "rounded";
  /** Allow horizontal scroll on overflow (mobile). Default true. */
  scrollable?: boolean;
  className?: string;
  ariaLabel?: string;
}

/**
 * Filter / tab segmented control. Replaces hand-rolled button clusters
 * scattered across session-list, member-list, inventory, fund-transactions —
 * each previously rolled their own active/inactive styles.
 */
export function TabSegment<V extends string = string>({
  options,
  value,
  onChange,
  variant = "pills",
  scrollable = true,
  className,
  ariaLabel,
}: TabSegmentProps<V>) {
  if (variant === "rounded") {
    return (
      <div
        role="tablist"
        aria-label={ariaLabel}
        className={cn(
          "bg-muted flex gap-1 rounded-xl p-1.5",
          scrollable && "overflow-x-auto",
          className,
        )}
      >
        {options.map((opt) => {
          const active = opt.value === value;
          const Icon = opt.icon;
          return (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(opt.value)}
              className={cn(
                "inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {Icon && <Icon className="h-4 w-4 shrink-0" />}
              <span>{opt.label}</span>
              {opt.badge !== undefined && (
                <span className="ml-1 tabular-nums">{opt.badge}</span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  // pills variant
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "flex gap-2",
        scrollable && "scrollbar-none -mx-4 overflow-x-auto px-4",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium whitespace-nowrap transition-colors",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {Icon && <Icon className="h-4 w-4 shrink-0" />}
            <span>{opt.label}</span>
            {opt.badge !== undefined && (
              <span
                className={cn(
                  "tabular-nums",
                  active
                    ? "text-primary-foreground/80"
                    : "text-muted-foreground",
                )}
              >
                {opt.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type StatTone =
  | "primary"
  | "green"
  | "orange"
  | "red"
  | "amber"
  | "neutral";

const TONES: Record<StatTone, { bg: string; ring: string; text: string }> = {
  primary: {
    bg: "bg-primary/5 dark:bg-primary/10",
    ring: "ring-primary/30 dark:ring-primary/40",
    text: "text-primary",
  },
  green: {
    bg: "bg-green-500/5 dark:bg-green-500/10",
    ring: "ring-green-500/30 dark:ring-green-500/40",
    text: "text-green-600 dark:text-green-400",
  },
  orange: {
    bg: "bg-orange-500/5 dark:bg-orange-500/10",
    ring: "ring-orange-500/30 dark:ring-orange-500/40",
    text: "text-orange-600 dark:text-orange-400",
  },
  red: {
    bg: "bg-red-500/5 dark:bg-red-500/10",
    ring: "ring-red-500/30 dark:ring-red-500/40",
    text: "text-red-600 dark:text-red-400",
  },
  amber: {
    bg: "bg-amber-500/5 dark:bg-amber-500/10",
    ring: "ring-amber-500/30 dark:ring-amber-500/40",
    text: "text-amber-600 dark:text-amber-400",
  },
  neutral: {
    bg: "bg-card",
    ring: "ring-border",
    text: "text-muted-foreground",
  },
};

interface StatTileProps {
  icon?: LucideIcon;
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: StatTone;
  /** Override value text color when tone color isn't desired on the value. */
  valueClassName?: string;
  /** Compact (p-3) vs default (p-4). */
  size?: "sm" | "md";
  className?: string;
}

/**
 * Status/tone-tinted KPI tile used in dashboards (fund overview, court rent
 * year totals, etc). Subtle opacity-based bg + matching ring so cards in a
 * grid are visually distinct without screaming.
 */
export function StatTile({
  icon: Icon,
  label,
  value,
  tone = "neutral",
  valueClassName,
  size = "md",
  className,
}: StatTileProps) {
  const t = TONES[tone];
  return (
    <div
      className={cn(
        "rounded-xl shadow-sm ring-1 backdrop-blur",
        size === "sm" ? "p-3" : "p-4",
        t.bg,
        t.ring,
        className,
      )}
    >
      <div className="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-xs">
        {Icon && <Icon className={cn("h-4 w-4 shrink-0", t.text)} />}
        <span className="truncate">{label}</span>
      </div>
      <div
        className={cn(
          "text-base font-bold tabular-nums sm:text-lg",
          t.text,
          valueClassName,
        )}
      >
        {value}
      </div>
    </div>
  );
}

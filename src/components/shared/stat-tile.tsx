import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type StatTone =
  | "primary"
  | "green"
  | "emerald"
  | "cyan"
  | "rose"
  | "slate"
  | "blue"
  | "orange"
  | "red"
  | "amber"
  | "neutral";

const TONES: Record<
  StatTone,
  { bg: string; ring: string; iconText: string; valueText: string }
> = {
  primary: {
    bg: "bg-primary/5 dark:bg-primary/10",
    ring: "ring-primary/30 dark:ring-primary/40",
    iconText: "text-primary",
    valueText: "text-primary",
  },
  green: {
    bg: "bg-green-500/5 dark:bg-green-500/10",
    ring: "ring-green-500/30 dark:ring-green-500/40",
    iconText: "text-green-600 dark:text-green-400",
    valueText: "text-green-600 dark:text-green-400",
  },
  emerald: {
    bg: "bg-emerald-500/5 dark:bg-emerald-500/10",
    ring: "ring-emerald-500/30 dark:ring-emerald-500/40",
    iconText: "text-emerald-600 dark:text-emerald-400",
    valueText: "text-emerald-600 dark:text-emerald-400",
  },
  cyan: {
    bg: "bg-cyan-500/5 dark:bg-cyan-500/10",
    ring: "ring-cyan-500/30 dark:ring-cyan-500/40",
    iconText: "text-cyan-600 dark:text-cyan-400",
    valueText: "text-cyan-600 dark:text-cyan-400",
  },
  rose: {
    bg: "bg-rose-500/5 dark:bg-rose-500/10",
    ring: "ring-rose-500/30 dark:ring-rose-500/40",
    iconText: "text-rose-600 dark:text-rose-400",
    valueText: "text-rose-600 dark:text-rose-400",
  },
  slate: {
    bg: "bg-slate-500/5 dark:bg-slate-500/10",
    ring: "ring-slate-500/30 dark:ring-slate-500/40",
    iconText: "text-slate-600 dark:text-slate-400",
    valueText: "text-slate-600 dark:text-slate-400",
  },
  blue: {
    bg: "bg-blue-500/5 dark:bg-blue-500/10",
    ring: "ring-blue-500/30 dark:ring-blue-500/40",
    iconText: "text-blue-600 dark:text-blue-400",
    valueText: "text-blue-600 dark:text-blue-400",
  },
  orange: {
    bg: "bg-orange-500/5 dark:bg-orange-500/10",
    ring: "ring-orange-500/30 dark:ring-orange-500/40",
    iconText: "text-orange-600 dark:text-orange-400",
    valueText: "text-orange-600 dark:text-orange-400",
  },
  red: {
    bg: "bg-red-500/5 dark:bg-red-500/10",
    ring: "ring-red-500/30 dark:ring-red-500/40",
    iconText: "text-red-600 dark:text-red-400",
    valueText: "text-red-600 dark:text-red-400",
  },
  amber: {
    bg: "bg-amber-500/5 dark:bg-amber-500/10",
    ring: "ring-amber-500/30 dark:ring-amber-500/40",
    iconText: "text-amber-600 dark:text-amber-400",
    valueText: "text-amber-600 dark:text-amber-400",
  },
  // Neutral tile = soft surface card without semantic accent. Value defaults to
  // foreground (bold) — caller can override via `valueClassName` to color the
  // value (e.g. emerald for "Quỹ còn dư") while keeping the surface neutral.
  neutral: {
    bg: "bg-background/60 dark:bg-background/40",
    ring: "ring-border/60",
    iconText: "text-muted-foreground",
    valueText: "text-foreground",
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
 *
 * Use `tone="neutral"` for a soft surface tile where the value gets its own
 * semantic color via `valueClassName` (e.g. emerald "Quỹ còn dư" inside a
 * neutral grid). Use the matching tone (`tone="emerald"` …) for fully tinted
 * tiles where bg + ring + value all share the accent.
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
        {Icon && <Icon className={cn("h-4 w-4 shrink-0", t.iconText)} />}
        <span className="truncate">{label}</span>
      </div>
      <div
        className={cn(
          "text-base font-bold tabular-nums sm:text-lg",
          t.valueText,
          valueClassName,
        )}
      >
        {value}
      </div>
    </div>
  );
}

import { cn } from "@/lib/utils";

interface StatGroupProps {
  /**
   * Cố định số cột (mobile + desktop dùng cùng grid). Override bằng
   * `responsive` để đổi cột theo breakpoint.
   */
  cols?: 2 | 3 | 4;
  /**
   * Responsive: object `{ base, sm?, md?, lg? }` overrides cố định cols.
   * Ví dụ `{ base: 2, sm: 4 }` = `grid-cols-2 sm:grid-cols-4`.
   */
  responsive?: {
    base: 2 | 3 | 4;
    sm?: 2 | 3 | 4;
    md?: 2 | 3 | 4;
    lg?: 2 | 3 | 4;
  };
  /** Gap between tiles. Default `3` = `gap-3` (12px). */
  gap?: 2 | 3 | 4;
  children: React.ReactNode;
  className?: string;
}

const COLS_BASE: Record<2 | 3 | 4, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
};
const COLS_SM: Record<2 | 3 | 4, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
};
const COLS_MD: Record<2 | 3 | 4, string> = {
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
};
const COLS_LG: Record<2 | 3 | 4, string> = {
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
};
const GAP: Record<2 | 3 | 4, string> = {
  2: "gap-2",
  3: "gap-3",
  4: "gap-4",
};

/**
 * Wrapper grid layout cho stat tiles (StatTile, StatCard). Centralize
 * responsive cols + gap để mọi dashboard / fund / court-rent grids dùng
 * cùng spacing.
 */
export function StatGroup({
  cols,
  responsive,
  gap = 3,
  children,
  className,
}: StatGroupProps) {
  const colClasses = responsive
    ? cn(
        COLS_BASE[responsive.base],
        responsive.sm && COLS_SM[responsive.sm],
        responsive.md && COLS_MD[responsive.md],
        responsive.lg && COLS_LG[responsive.lg],
      )
    : COLS_BASE[cols ?? 3];

  return (
    <div className={cn("grid", colClasses, GAP[gap], className)}>
      {children}
    </div>
  );
}

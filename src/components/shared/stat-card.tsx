import { cn } from "@/lib/utils";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface StatCardProps {
  icon?: LucideIcon;
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
  iconClassName?: string;
  badge?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  className?: string;
}

/**
 * KPI tile used on dashboard / session list / inventory / fund / finance.
 * Replaces hand-rolled `<Card><CardContent>` + icon-bg + label/value blocks.
 */
export function StatCard({
  icon: Icon,
  label,
  value,
  valueClassName,
  iconClassName,
  badge,
  href,
  onClick,
  className,
}: StatCardProps) {
  const inner = (
    <Card
      className={cn(
        "hover:border-primary/50 transition-colors active:scale-[0.99]",
        href || onClick ? "cursor-pointer" : "",
        className,
      )}
    >
      <CardContent className="flex items-center gap-3 p-4">
        {Icon ? (
          <div
            className={cn(
              "bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
              iconClassName,
            )}
          >
            <Icon className="h-5 w-5" aria-hidden />
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <span className="truncate">{label}</span>
            {badge}
          </div>
          <div
            className={cn(
              "text-lg font-semibold tracking-tight",
              valueClassName,
            )}
          >
            {value}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (href) return <Link href={href}>{inner}</Link>;
  if (onClick)
    return (
      <button type="button" onClick={onClick} className="w-full text-left">
        {inner}
      </button>
    );
  return inner;
}

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

export type SectionTone =
  | "neutral"
  | "primary"
  | "emerald"
  | "cyan"
  | "rose"
  | "slate"
  | "blue"
  | "amber"
  | "orange"
  | "red";

// Card tone giờ chỉ thay đổi MÀU VIỀN (không thay bg) → ngoài light/pink/dark
// theme đều cho ra surface trắng (hoặc card-color theo theme), không bị
// "tint khác nhau" giữa các theme. Màu nhận biết section dựa vào icon tone
// (TONE_ICON) + viền nhạt.
const TONE_CARD: Record<SectionTone, string> = {
  neutral: "",
  primary: "ring-primary/40 dark:ring-primary/50",
  emerald: "ring-emerald-300/60 dark:ring-emerald-700/50",
  cyan: "ring-cyan-300/60 dark:ring-cyan-700/50",
  rose: "ring-rose-300/60 dark:ring-rose-700/50",
  slate: "ring-slate-300/60 dark:ring-slate-700/50",
  blue: "ring-blue-300/60 dark:ring-blue-700/50",
  amber: "ring-amber-300/60 dark:ring-amber-700/50",
  orange: "ring-orange-300/60 dark:ring-orange-700/50",
  red: "ring-red-300/60 dark:ring-red-700/50",
};

const TONE_ICON: Record<SectionTone, string> = {
  neutral: "text-muted-foreground",
  primary: "text-primary",
  emerald: "text-emerald-600 dark:text-emerald-400",
  cyan: "text-cyan-600 dark:text-cyan-400",
  rose: "text-rose-600 dark:text-rose-400",
  slate: "text-slate-600 dark:text-slate-400",
  blue: "text-blue-600 dark:text-blue-400",
  amber: "text-amber-600 dark:text-amber-400",
  orange: "text-orange-600 dark:text-orange-400",
  red: "text-red-600 dark:text-red-400",
};

interface SectionCardProps {
  /** Tinted accent color. `neutral` = plain card. */
  tone?: SectionTone;
  icon?: LucideIcon;
  title: React.ReactNode;
  /** Top-right action — typically a `<Link><Button variant="outline" size="sm">…</Button></Link>`. */
  action?: React.ReactNode;
  /** Optional subtitle row directly under the title. */
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  /** Override content padding-bottom. Default `pb-4`. */
  contentClassName?: string;
}

/**
 * Tinted "section" card used for dashboard / fund / court-rent groupings.
 * Standardises border, background, padding, header layout, icon color so
 * every section in the admin UI looks identical except for the accent tone.
 *
 * Replaces hand-rolled `<Card className="border-emerald-200/50 bg-emerald-50/40 …">`
 * patterns scattered across pages.
 */
export function SectionCard({
  tone = "neutral",
  icon: Icon,
  title,
  action,
  subtitle,
  children,
  className,
  contentClassName,
}: SectionCardProps) {
  return (
    <Card className={cn("relative", TONE_CARD[tone], className)}>
      {/* Header dùng flex thay vì absolute action — tránh action button bị
       * "dính" vào content bên dưới khi body có grid stat-tiles cao và
       * extend dưới action. Title truncate ở giữa, action không co. */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="font-heading flex min-w-0 items-center gap-2 text-base leading-snug font-medium">
            {Icon && (
              <Icon className={cn("h-5 w-5 shrink-0", TONE_ICON[tone])} />
            )}
            <span className="truncate">{title}</span>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
        {subtitle && <div className="mt-1.5">{subtitle}</div>}
      </div>
      {children !== undefined && (
        <CardContent className={cn("pb-4", contentClassName)}>
          {children}
        </CardContent>
      )}
    </Card>
  );
}

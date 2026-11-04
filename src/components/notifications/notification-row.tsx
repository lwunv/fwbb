"use client";

import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  renderNotification,
  type NotificationView,
  type Translate,
} from "@/lib/notifications/render";

type AppLocale = "vi" | "en" | "zh";

/** Giờ Việt Nam bất kể múi giờ máy xem (cùng quy ước với render.ts). */
function formatWhen(iso: string, locale: AppLocale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export function NotificationRow({
  item,
  onSelect,
}: {
  item: NotificationView;
  onSelect: (item: NotificationView) => void;
}) {
  const t = useTranslations("notifications");
  const locale = useLocale() as AppLocale;
  const { title, body } = renderNotification(
    t as unknown as Translate,
    item,
    locale,
  );
  const unread = item.readAt === null;
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={cn(
        "hover:bg-accent flex min-h-11 w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors",
        unread ? "bg-primary/5 border-primary/20" : "bg-card/60",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-2 h-2 w-2 shrink-0 rounded-full",
          unread ? "bg-primary" : "bg-transparent",
        )}
      />
      <span className="min-w-0 flex-1 space-y-0.5">
        <span
          className={cn(
            "block text-base leading-snug",
            unread ? "font-semibold" : "font-medium",
          )}
        >
          {title}
        </span>
        <span className="text-muted-foreground block text-sm leading-snug break-words">
          {body}
        </span>
        <span className="text-muted-foreground block text-sm">
          {formatWhen(item.createdAt, locale)}
        </span>
      </span>
    </button>
  );
}

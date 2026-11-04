"use client";

import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { ZaloShareButton } from "./zalo-share-button";
import type { NotificationScope } from "./use-notifications";
import {
  buildLowAttendanceText,
  buildUnvotedReminderText,
  voteLink,
} from "@/lib/zalo-share";
import {
  renderNotification,
  type NotificationView,
  type Translate,
} from "@/lib/notifications/render";

type AppLocale = "vi" | "en" | "zh";

/**
 * "dd/MM HH:mm" theo giờ Việt Nam bất kể múi giờ máy xem (cùng quy ước với
 * render.ts). Ghép từ `formatToParts` để thứ tự ngày/tháng không đổi theo
 * ngôn ngữ giao diện.
 */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const g = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${g("day")}/${g("month")} ${g("hour")}:${g("minute")}`;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" ? v : 0);

/**
 * Nội dung tin Zalo cho các kind của admin có nút soạn tin; kind khác trả null.
 * Dựng ở đây (không lưu trong DB) để sửa câu chữ không cần migrate tin cũ.
 */
function zaloShareText(item: NotificationView): string | null {
  const p = item.payload ?? {};
  if (item.kind === "unvoted_before_deadline") {
    return buildUnvotedReminderText({
      sessionDate: str(p.sessionDate),
      startTime: str(p.startTime),
      voteDeadline: typeof p.voteDeadline === "string" ? p.voteDeadline : null,
      names: Array.isArray(p.names) ? p.names.map(String) : [],
    });
  }
  if (item.kind === "low_attendance" && item.entityId !== null) {
    return buildLowAttendanceText({
      sessionDate: str(p.sessionDate),
      startTime: str(p.startTime),
      headcount: num(p.headcount),
      maxPlayers: num(p.maxPlayers),
      link: voteLink(item.entityId),
    });
  }
  return null;
}

export function NotificationRow({
  item,
  scope = "member",
  zaloGroupUrl = "",
  onSelect,
}: {
  item: NotificationView;
  scope?: NotificationScope;
  /** Link nhóm Zalo admin đã cài; rỗng thì nút chỉ chép tin. */
  zaloGroupUrl?: string;
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
  const shareText = scope === "admin" ? zaloShareText(item) : null;
  // Nút chia sẻ nằm NGOÀI nút chọn tin: lồng button trong button là HTML sai
  // và làm bấm chia sẻ cũng đánh dấu đã đọc + chuyển trang.
  return (
    <div
      className={cn(
        "rounded-xl border transition-colors",
        unread ? "bg-primary/5 border-primary/20" : "bg-card/60",
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(item)}
        className={cn(
          "hover:bg-accent flex min-h-11 w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors",
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
            {formatWhen(item.createdAt)}
          </span>
        </span>
      </button>
      {shareText && (
        <div className="px-3 pb-3">
          <ZaloShareButton text={shareText} zaloGroupUrl={zaloGroupUrl} />
        </div>
      )}
    </div>
  );
}

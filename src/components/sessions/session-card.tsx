"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Clock, MapPin, Navigation, Users } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { formatSessionDate, ymdInVN } from "@/lib/date-format";
import {
  StatusBadge,
  type StatusVariant,
} from "@/components/shared/status-badge";
import { VoteCountdown } from "@/components/sessions/vote-countdown";
import type { AppLocale } from "@/lib/date-fns-locale";
import type { ReactNode } from "react";

interface SessionCardProps {
  date: string;
  startTime: string | null;
  endTime: string | null;
  courtName?: string | null;
  courtMapLink?: string | null;
  status: string | null;
  playerCount: number;
  dinerCount: number;
  guestPlayCount: number;
  guestDineCount: number;
  /**
   * Khi set + buổi còn votable (voting/confirmed) → render đồng hồ đếm ngược
   * theo GIÂY ngay TRONG thẻ. Quá hạn → component tự hiển "Đã đóng vote".
   */
  voteDeadline?: string | null;
  /** Nội dung render ở ĐỈNH thẻ (vd hàng chip chọn thứ) — nằm bên trong card. */
  topSlot?: ReactNode;
}

export function SessionCard({
  date,
  startTime,
  endTime,
  courtName,
  courtMapLink,
  status,
  playerCount,
  dinerCount,
  guestPlayCount,
  guestDineCount,
  voteDeadline,
  topSlot,
}: SessionCardProps) {
  const t = useTranslations("sessions");
  const tF = useTranslations("finance");
  const locale = useLocale() as AppLocale;

  const statusKey = (status ?? "voting") as StatusVariant;
  const statusLabelKey = (
    ["voting", "confirmed", "completed", "cancelled"].includes(statusKey)
      ? statusKey
      : "voting"
  ) as "voting" | "confirmed" | "completed" | "cancelled";
  // Buổi đã qua nhưng vẫn voting/confirmed → "Cần xác nhận", không LED xanh.
  const isPastPending =
    (statusKey === "voting" || statusKey === "confirmed") && date < ymdInVN();
  const isVoting = statusKey === "voting" && !isPastPending;
  const badgeVariant: StatusVariant = isPastPending
    ? "needsConfirm"
    : statusKey;
  const badgeText = isPastPending ? tF("needsConfirm") : t(statusLabelKey);

  // Countdown chỉ có nghĩa với buổi còn đang mở vote (voting/confirmed).
  const showCountdown =
    !!voteDeadline && (statusKey === "voting" || statusKey === "confirmed");

  const card = (
    <Card className={isVoting ? "ring-0" : ""}>
      <CardContent className="relative space-y-3 p-4">
        {topSlot}
        {/* Có chips (trang chủ): countdown absolute góc phải-trên (đè vùng phải
            trống của hàng chip → KHÔNG chiếm height). Không chips (vote page):
            render inline trong header (không có hàng chip để đè). */}
        {topSlot && showCountdown && (
          <div className="absolute top-4 right-4 z-20">
            <VoteCountdown deadline={voteDeadline ?? null} variant="compact" />
          </div>
        )}
        <div className="flex items-start justify-between gap-2">
          {/* Ngày + giờ trên 1 dòng header. */}
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
            <h2 className="text-lg font-bold capitalize">
              {formatSessionDate(date, "weekdayLong", locale)}
            </h2>
            <span className="text-muted-foreground inline-flex items-center gap-1 text-sm font-normal">
              <Clock className="h-4 w-4" />
              {startTime ?? "20:30"} - {endTime ?? "22:30"}
            </span>
            {!topSlot && showCountdown && (
              <VoteCountdown
                deadline={voteDeadline ?? null}
                variant="compact"
              />
            )}
          </div>
          <StatusBadge variant={badgeVariant}>{badgeText}</StatusBadge>
        </div>

        <div className="space-y-2 text-sm">
          {courtName && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <MapPin className="text-muted-foreground h-4 w-4 shrink-0" />
              <span className="min-w-0">{courtName}</span>
              {courtMapLink && (
                <a
                  href={courtMapLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary inline-flex shrink-0 items-center gap-1 text-xs font-medium hover:underline"
                >
                  <Navigation className="h-3 w-3 shrink-0" aria-hidden />
                  {t("directions")}
                </a>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Users className="text-muted-foreground h-4 w-4" />
            <div className="flex gap-4">
              <span>
                {t("badminton")}:{" "}
                <strong className="text-primary tabular-nums">
                  {playerCount + guestPlayCount}
                </strong>{" "}
                <span className="text-foreground/80">{t("people")}</span>
                {guestPlayCount > 0 && (
                  <span className="tabular-nums">
                    {" "}
                    (
                    <span className="text-foreground/80">
                      {t("including")}
                    </span>{" "}
                    <span className="text-primary">{guestPlayCount}</span>{" "}
                    <span className="text-foreground/80">{t("guest")}</span>)
                  </span>
                )}
              </span>
              <span>
                {t("dining")}:{" "}
                <strong className="text-orange-600 tabular-nums dark:text-orange-400">
                  {dinerCount + guestDineCount}
                </strong>{" "}
                <span className="text-foreground/80">{t("people")}</span>
                {guestDineCount > 0 && (
                  <span className="tabular-nums">
                    {" "}
                    (
                    <span className="text-foreground/80">
                      {t("including")}
                    </span>{" "}
                    <span className="text-orange-600 dark:text-orange-400">
                      {guestDineCount}
                    </span>{" "}
                    <span className="text-foreground/80">{t("guest")}</span>)
                  </span>
                )}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (isVoting) {
    return <div className="led-border">{card}</div>;
  }
  return card;
}

"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Clock, MapPin, Navigation, Users } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { formatSessionDate, ymdInVN } from "@/lib/date-format";
import { StatusBadge } from "@/components/shared/status-badge";
import { deriveSessionBadge } from "@/lib/session-status";
import { VoteCountdown } from "@/components/sessions/vote-countdown";
import type { AppLocale } from "@/lib/date-fns-locale";
import { useEffect, useState, type ReactNode } from "react";

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
  /** Đủ 16 người chơi cầu → hiện badge "Hết slot". */
  playFull?: boolean;
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
  playFull = false,
  topSlot,
}: SessionCardProps) {
  const t = useTranslations("sessions");
  const tF = useTranslations("finance");
  const tv = useTranslations("voting");
  const locale = useLocale() as AppLocale;

  // Badge derivation shared with session-list + session-detail (single source).
  const {
    variant: badgeVariant,
    labelKey,
    isPastPending,
    isVoting,
  } = deriveSessionBadge(status, date, ymdInVN());
  const badgeText = isPastPending ? tF("needsConfirm") : t(labelKey);

  // Countdown chỉ có nghĩa với buổi còn đang mở vote (voting/confirmed).
  // Normalize null → "voting" (khớp deriveSessionBadge) để buổi status=null +
  // có deadline vẫn hiện đồng hồ như trước refactor.
  const normStatus = status ?? "voting";
  const showCountdown =
    !!voteDeadline && (normStatus === "voting" || normStatus === "confirmed");

  // Khi deadline đã qua, badge "Đang vote" (theo status DB) + đồng hồ "Đã đóng
  // vote" hiện cùng lúc → mâu thuẫn. Theo dõi mốc deadline client-side để khi
  // hết giờ chỉ hiện "Đã đóng vote", ẩn badge "Đang vote". Init false cho
  // hydration-safe; effect hội tụ ở tick client đầu tiên.
  const [deadlinePassed, setDeadlinePassed] = useState(false);
  useEffect(() => {
    if (!showCountdown || !voteDeadline) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset khi hết deadline/không còn votable.
      setDeadlinePassed(false);
      return;
    }
    const msUntil = new Date(voteDeadline).getTime() - Date.now();
    if (msUntil <= 0) {
      setDeadlinePassed(true);
      return;
    }
    setDeadlinePassed(false);
    const timer = setTimeout(() => setDeadlinePassed(true), msUntil);
    return () => clearTimeout(timer);
  }, [showCountdown, voteDeadline]);

  const card = (
    <Card className={isVoting ? "ring-0" : ""}>
      <CardContent className="space-y-3 p-4">
        {topSlot}
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
          </div>
          {/* Badge trạng thái + đồng hồ đếm ngược xếp dọc bên phải, TRONG luồng
              bình thường. Trước đây countdown đặt absolute đè lên hàng chip →
              chồng UI khi chip lấp đầy chiều ngang (bug trang chủ). */}
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            {playFull && (
              <span className="border-destructive/30 bg-destructive/10 text-destructive inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold">
                {tv("slotsFull")}
              </span>
            )}
            {showCountdown && deadlinePassed ? (
              // Hết giờ vote: chỉ hiện "Đã đóng vote" (đồng hồ), KHÔNG hiện
              // badge "Đang vote" → tránh 2 trạng thái mâu thuẫn.
              <VoteCountdown
                deadline={voteDeadline ?? null}
                variant="compact"
              />
            ) : (
              <>
                <StatusBadge variant={badgeVariant}>{badgeText}</StatusBadge>
                {showCountdown && (
                  <VoteCountdown
                    deadline={voteDeadline ?? null}
                    variant="compact"
                  />
                )}
              </>
            )}
          </div>
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
                <strong className="text-primary text-xl font-extrabold tabular-nums">
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
                <strong className="text-xl font-extrabold text-orange-600 tabular-nums dark:text-orange-400">
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

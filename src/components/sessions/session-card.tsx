"use client";

import { Card, CardContent } from "@/components/ui/card";
import { formatK } from "@/lib/utils";
import { Clock, MapPin, Navigation, Users } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { formatSessionDate } from "@/lib/date-format";
import {
  StatusBadge,
  type StatusVariant,
} from "@/components/shared/status-badge";
import type { AppLocale } from "@/lib/date-fns-locale";

interface SessionCardProps {
  date: string;
  startTime: string | null;
  endTime: string | null;
  courtName?: string | null;
  courtMapLink?: string | null;
  courtPrice?: number | null;
  status: string | null;
  playerCount: number;
  dinerCount: number;
  guestPlayCount: number;
  guestDineCount: number;
}

export function SessionCard({
  date,
  startTime,
  endTime,
  courtName,
  courtMapLink,
  courtPrice,
  status,
  playerCount,
  dinerCount,
  guestPlayCount,
  guestDineCount,
}: SessionCardProps) {
  const t = useTranslations("sessions");
  const locale = useLocale() as AppLocale;

  const statusKey = (status ?? "voting") as StatusVariant;
  const statusLabelKey = (
    ["voting", "confirmed", "completed", "cancelled"].includes(statusKey)
      ? statusKey
      : "voting"
  ) as "voting" | "confirmed" | "completed" | "cancelled";
  const isVoting = statusKey === "voting";

  const card = (
    <Card className={isVoting ? "ring-0" : ""}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-bold capitalize">
            {formatSessionDate(date, "weekdayLong", locale)}
          </h2>
          <StatusBadge variant={statusKey}>{t(statusLabelKey)}</StatusBadge>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <Clock className="text-muted-foreground h-4 w-4" />
            <span>
              {startTime ?? "20:30"} - {endTime ?? "22:30"}
            </span>
          </div>

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
              {courtPrice != null && (
                <span className="text-primary font-medium">
                  ({formatK(courtPrice)})
                </span>
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
                {t("people")}
                {guestPlayCount > 0 && (
                  <span className="text-primary/85 tabular-nums">
                    {" "}
                    ({guestPlayCount} {t("guest")})
                  </span>
                )}
              </span>
              <span>
                {t("dining")}:{" "}
                <strong className="text-orange-600 tabular-nums dark:text-orange-400">
                  {dinerCount + guestDineCount}
                </strong>{" "}
                {t("people")}
                {guestDineCount > 0 && (
                  <span className="text-orange-600/90 tabular-nums dark:text-orange-400/90">
                    {" "}
                    ({guestDineCount} {t("guest")})
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

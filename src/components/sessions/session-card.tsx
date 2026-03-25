"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatK } from "@/lib/utils";
import { Clock, MapPin, Navigation, Users } from "lucide-react";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { useTranslations } from "next-intl";

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

  const statusStyles: Record<string, { labelKey: "voting" | "confirmed" | "completed" | "cancelled"; badgeBg: string; badgeText: string }> = {
    voting: { labelKey: "voting", badgeBg: "bg-green-100 dark:bg-green-900/40", badgeText: "text-green-700 dark:text-green-300" },
    confirmed: { labelKey: "confirmed", badgeBg: "bg-green-100 dark:bg-green-900/40", badgeText: "text-green-700 dark:text-green-300" },
    completed: { labelKey: "completed", badgeBg: "bg-blue-100 dark:bg-blue-900/40", badgeText: "text-blue-700 dark:text-blue-300" },
    cancelled: { labelKey: "cancelled", badgeBg: "bg-red-100 dark:bg-red-900/40", badgeText: "text-red-700 dark:text-red-300" },
  };

  const statusInfo = statusStyles[status ?? "voting"];

  function formatSessionDate(dateStr: string) {
    try {
      const d = new Date(dateStr + "T00:00:00");
      return format(d, "EEEE, dd/MM/yyyy", { locale: vi });
    } catch {
      return dateStr;
    }
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between">
          <h2 className="font-bold text-lg capitalize">
            {formatSessionDate(date)}
          </h2>
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusInfo.badgeBg} ${statusInfo.badgeText}`}>
            {t(statusInfo.labelKey)}
          </span>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span>{startTime ?? "20:30"} - {endTime ?? "22:30"}</span>
          </div>

          {courtName && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0">{courtName}</span>
              {courtMapLink && (
                <a
                  href={courtMapLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
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
            <Users className="h-4 w-4 text-muted-foreground" />
            <div className="flex gap-4">
              <span>
                {t("badminton")}:{" "}
                <strong className="tabular-nums text-primary">
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
                <strong className="tabular-nums text-orange-600 dark:text-orange-400">
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
}

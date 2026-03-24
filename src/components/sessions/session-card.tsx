"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatVND } from "@/lib/utils";
import { Calendar, Clock, MapPin, Users } from "lucide-react";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { useTranslations } from "next-intl";

interface SessionCardProps {
  date: string;
  startTime: string | null;
  endTime: string | null;
  courtName?: string | null;
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
  courtPrice,
  status,
  playerCount,
  dinerCount,
  guestPlayCount,
  guestDineCount,
}: SessionCardProps) {
  const t = useTranslations("sessions");

  const statusConfig: Record<string, { labelKey: "voting" | "confirmed" | "completed" | "cancelled"; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    voting: { labelKey: "voting", variant: "outline" },
    confirmed: { labelKey: "confirmed", variant: "default" },
    completed: { labelKey: "completed", variant: "secondary" },
    cancelled: { labelKey: "cancelled", variant: "destructive" },
  };

  const statusInfo = statusConfig[status ?? "voting"];

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
          <Badge variant={statusInfo.variant}>{t(statusInfo.labelKey)}</Badge>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span>{startTime ?? "20:30"} - {endTime ?? "22:30"}</span>
          </div>

          {courtName && (
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span>{courtName}</span>
              {courtPrice != null && (
                <span className="text-primary font-medium">
                  ({formatVND(courtPrice)})
                </span>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <div className="flex gap-4">
              <span>
                {t("badminton")}: <strong>{playerCount}</strong> {t("people")}
                {guestPlayCount > 0 && <span className="text-muted-foreground"> +{guestPlayCount} {t("guest")}</span>}
              </span>
              <span>
                {t("dining")}: <strong>{dinerCount}</strong> {t("people")}
                {guestDineCount > 0 && <span className="text-muted-foreground"> +{guestDineCount} {t("guest")}</span>}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

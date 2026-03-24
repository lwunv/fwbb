"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import { vi } from "date-fns/locale";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronUp, Users, UtensilsCrossed } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { formatVND } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface SessionAttendee {
  id: number;
  name: string;
  memberId: number | null;
  isGuest: boolean;
  attendsPlay: boolean;
  attendsDine: boolean;
}

interface HistorySession {
  id: number;
  date: string;
  status: string;
  courtName: string;
  courtPrice: number;
  shuttlecockCost: number;
  diningBill: number;
  totalCost: number;
  playerCount: number;
  dinerCount: number;
  attendees: SessionAttendee[];
}

interface HistoryClientProps {
  sessions: HistorySession[];
}

function formatDateLabel(dateStr: string): string {
  try {
    const d = parseISO(dateStr);
    return format(d, "EEEE, dd/MM/yyyy", { locale: vi });
  } catch {
    return dateStr;
  }
}

export function HistoryClient({ sessions }: HistoryClientProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const t = useTranslations("history");
  const tSessions = useTranslations("sessions");

  const toggle = (id: number) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <div className="space-y-3">
      {sessions.map((session) => {
        const isExpanded = expandedId === session.id;
        const isCompleted = session.status === "completed";

        return (
          <Card key={session.id} className="overflow-hidden">
            <button
              onClick={() => toggle(session.id)}
              className="w-full text-left"
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium capitalize">
                        {formatDateLabel(session.date)}
                      </span>
                      <Badge
                        variant={isCompleted ? "secondary" : "destructive"}
                        className="text-[10px]"
                      >
                        {isCompleted ? t("completed") : t("cancelled")}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {session.courtName}
                    </p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {session.playerCount} {t("play")}
                      </span>
                      <span className="flex items-center gap-1">
                        <UtensilsCrossed className="h-3 w-3" />
                        {session.dinerCount} {t("dine")}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {isCompleted && (
                      <span className="text-sm font-semibold">
                        {formatVND(session.totalCost)}
                      </span>
                    )}
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </div>
              </CardContent>
            </button>

            {isExpanded && isCompleted && (
              <div className="border-t px-4 py-3 space-y-3 bg-muted/30">
                {/* Cost breakdown */}
                <div className="space-y-1">
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                    {t("costBreakdown")}
                  </h4>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <span className="text-muted-foreground">{t("court")}:</span>
                    <span className="text-right">
                      {formatVND(session.courtPrice)}
                    </span>
                    <span className="text-muted-foreground">{t("shuttlecock")}:</span>
                    <span className="text-right">
                      {formatVND(session.shuttlecockCost)}
                    </span>
                    <span className="text-muted-foreground">{t("dining")}:</span>
                    <span className="text-right">
                      {formatVND(session.diningBill)}
                    </span>
                    <span className="font-medium">{t("total")}:</span>
                    <span className="text-right font-medium">
                      {formatVND(session.totalCost)}
                    </span>
                  </div>
                </div>

                {/* Attendees */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                    {t("participants")}
                  </h4>
                  <div className="space-y-1.5">
                    {session.attendees.map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center gap-2 text-sm"
                      >
                        {a.memberId ? (
                          <MemberAvatar memberId={a.memberId} size={24} />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px]">
                            K
                          </div>
                        )}
                        <span className={cn(a.isGuest && "italic text-muted-foreground")}>
                          {a.name}
                          {a.isGuest && ` (${t("guest")})`}
                        </span>
                        <div className="flex gap-1 ml-auto">
                          {a.attendsPlay && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                              {tSessions("play")}
                            </Badge>
                          )}
                          {a.attendsDine && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                              {tSessions("dine")}
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {isExpanded && !isCompleted && (
              <div className="border-t px-4 py-3 bg-muted/30">
                <p className="text-sm text-muted-foreground">
                  {t("sessionCancelled")}
                </p>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

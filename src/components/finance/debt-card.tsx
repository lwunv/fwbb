"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { formatK } from "@/lib/utils";
import { Calendar, CheckCircle, ChevronDown, ChevronUp } from "lucide-react";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { useTranslations } from "next-intl";

export interface DebtCardData {
  id: number;
  sessionId: number;
  memberId: number;
  /** null/undefined: emoji theo memberId */
  memberAvatarKey?: string | null;
  /** URL ảnh đại diện từ Facebook */
  memberAvatarUrl?: string | null;
  memberName?: string;
  sessionDate: string;
  playAmount: number;
  dineAmount: number;
  guestPlayAmount: number;
  guestDineAmount: number;
  totalAmount: number;
  memberConfirmed: boolean;
  adminConfirmed: boolean;
}

interface DebtCardProps {
  debt: DebtCardData;
  showMemberInfo?: boolean;
  onPayAction?: (debtId: number) => void;
  actionLabel?: string;
  actionLoading?: boolean;
}

function formatSessionDate(dateStr: string) {
  try {
    const date = new Date(dateStr + "T00:00:00");
    return format(date, "dd/MM/yyyy (EEEE)", { locale: vi });
  } catch {
    return dateStr;
  }
}

export function DebtCard({
  debt,
  showMemberInfo = false,
  onPayAction,
  actionLabel,
  actionLoading,
}: DebtCardProps) {
  const t = useTranslations("finance");
  const [expanded, setExpanded] = useState(false);
  const hasBreakdown = debt.playAmount > 0 || debt.dineAmount > 0 || debt.guestPlayAmount > 0 || debt.guestDineAmount > 0;

  function getStatusBadge(memberConfirmed: boolean, adminConfirmed: boolean) {
    if (adminConfirmed) {
      return { label: t("confirmed"), variant: "default" as const };
    }
    if (memberConfirmed) {
      return { label: t("paid"), variant: "default" as const };
    }
    return { label: t("unpaid"), variant: "destructive" as const };
  }

  const status = getStatusBadge(debt.memberConfirmed, debt.adminConfirmed);

  return (
    <Card size="sm">
      <CardContent className="p-3 space-y-2">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {showMemberInfo && (
              <MemberAvatar memberId={debt.memberId} avatarKey={debt.memberAvatarKey} avatarUrl={debt.memberAvatarUrl} size={28} />
            )}
            <div className="min-w-0">
              {showMemberInfo && debt.memberName && (
                <div className="text-sm font-medium truncate">
                  {debt.memberName}
                </div>
              )}
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Calendar className="h-3 w-3" />
                <span>{formatSessionDate(debt.sessionDate)}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex flex-col items-end gap-1">
              <span className={`text-base font-bold ${debt.adminConfirmed ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
                {formatK(debt.totalAmount)}
              </span>
              <Badge variant={status.variant}>{status.label}</Badge>
            </div>
            {hasBreakdown && (
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            )}
          </div>
        </div>

        {/* Breakdown detail */}
        {expanded && hasBreakdown && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground border-t pt-2">
            {debt.playAmount > 0 && <span>🏸 {t("play")}: <strong className="text-primary">{formatK(debt.playAmount)}</strong></span>}
            {debt.dineAmount > 0 && <span>🍻 {t("dine")}: <strong className="text-orange-500 dark:text-orange-400">{formatK(debt.dineAmount)}</strong></span>}
            {debt.guestPlayAmount > 0 && <span>🏸👤 {t("guestPlay")}: <strong className="text-primary">{formatK(debt.guestPlayAmount)}</strong></span>}
            {debt.guestDineAmount > 0 && <span>🍻👤 {t("guestDine")}: <strong className="text-orange-500 dark:text-orange-400">{formatK(debt.guestDineAmount)}</strong></span>}
          </div>
        )}

        {/* Action button */}
        {onPayAction && !debt.adminConfirmed && !debt.memberConfirmed && (
          <Button
            size="sm"
            variant={debt.memberConfirmed ? "outline" : "default"}
            onClick={() => onPayAction(debt.id)}
            disabled={actionLoading}
            className="w-full"
          >
            <CheckCircle className="h-3 w-3 mr-1" />
            {actionLabel ?? t("paid")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

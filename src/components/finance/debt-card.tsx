"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { formatVND } from "@/lib/utils";
import { Calendar, CheckCircle } from "lucide-react";
import { format } from "date-fns";
import { vi } from "date-fns/locale";

export interface DebtCardData {
  id: number;
  sessionId: number;
  memberId: number;
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

function getStatusBadge(memberConfirmed: boolean, adminConfirmed: boolean) {
  if (adminConfirmed) {
    return { label: "Da xac nhan", variant: "default" as const };
  }
  if (memberConfirmed) {
    return { label: "Cho admin", variant: "secondary" as const };
  }
  return { label: "Chua thanh toan", variant: "destructive" as const };
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
  const status = getStatusBadge(debt.memberConfirmed, debt.adminConfirmed);
  const hasBreakdown =
    debt.playAmount > 0 ||
    debt.dineAmount > 0 ||
    debt.guestPlayAmount > 0 ||
    debt.guestDineAmount > 0;

  return (
    <Card size="sm">
      <CardContent className="p-3 space-y-2">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {showMemberInfo && (
              <MemberAvatar memberId={debt.memberId} size={28} />
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
          <div className="flex flex-col items-end gap-1">
            <span className="text-sm font-bold text-primary">
              {formatVND(debt.totalAmount)}
            </span>
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
        </div>

        {/* Breakdown */}
        {hasBreakdown && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-muted-foreground border-t pt-2">
            {debt.playAmount > 0 && (
              <>
                <span>Choi:</span>
                <span className="text-right">{formatVND(debt.playAmount)}</span>
              </>
            )}
            {debt.dineAmount > 0 && (
              <>
                <span>An:</span>
                <span className="text-right">{formatVND(debt.dineAmount)}</span>
              </>
            )}
            {debt.guestPlayAmount > 0 && (
              <>
                <span>Khach choi:</span>
                <span className="text-right">{formatVND(debt.guestPlayAmount)}</span>
              </>
            )}
            {debt.guestDineAmount > 0 && (
              <>
                <span>Khach an:</span>
                <span className="text-right">{formatVND(debt.guestDineAmount)}</span>
              </>
            )}
          </div>
        )}

        {/* Action button */}
        {onPayAction && !debt.adminConfirmed && (
          <Button
            size="sm"
            variant={debt.memberConfirmed ? "outline" : "default"}
            onClick={() => onPayAction(debt.id)}
            disabled={actionLoading}
            className="w-full"
          >
            <CheckCircle className="h-3 w-3 mr-1" />
            {actionLabel ?? "Da thanh toan"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

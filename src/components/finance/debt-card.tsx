"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { formatK } from "@/lib/utils";
import {
  Calendar,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  QrCode,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { formatSessionDate } from "@/lib/date-format";
import type { AppLocale } from "@/lib/date-fns-locale";
import { VietQRPayment } from "@/components/payment/vietqr-payment";

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

export function DebtCard({
  debt,
  showMemberInfo = false,
  onPayAction,
  actionLabel,
  actionLoading,
}: DebtCardProps) {
  const t = useTranslations("finance");
  const locale = useLocale() as AppLocale;
  const [expanded, setExpanded] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const hasBreakdown =
    debt.playAmount > 0 ||
    debt.dineAmount > 0 ||
    debt.guestPlayAmount > 0 ||
    debt.guestDineAmount > 0;
  const isUnpaid = !debt.memberConfirmed && !debt.adminConfirmed;

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
      <CardContent className="space-y-2 p-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {showMemberInfo && (
              <MemberAvatar
                memberId={debt.memberId}
                avatarKey={debt.memberAvatarKey}
                avatarUrl={debt.memberAvatarUrl}
                size={28}
              />
            )}
            <div className="min-w-0">
              {showMemberInfo && debt.memberName && (
                <div className="truncate text-sm font-medium">
                  {debt.memberName}
                </div>
              )}
              <div className="text-muted-foreground flex items-center gap-1 text-xs">
                <Calendar className="h-4 w-4" />
                <span>
                  {formatSessionDate(debt.sessionDate, "weekdayLong", locale)}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex flex-col items-end gap-1">
              <span
                className={`text-base font-bold ${debt.adminConfirmed ? "text-green-600 dark:text-green-400" : "text-destructive"}`}
              >
                {formatK(debt.totalAmount)}
              </span>
              <Badge variant={status.variant}>{status.label}</Badge>
            </div>
            {hasBreakdown && (
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
        </div>

        {/* Breakdown detail */}
        {expanded && hasBreakdown && (
          <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-xs">
            {debt.playAmount > 0 && (
              <span>
                🏸 {t("play")}:{" "}
                <strong className="text-primary">
                  {formatK(debt.playAmount)}
                </strong>
              </span>
            )}
            {debt.dineAmount > 0 && (
              <span>
                🍻 {t("dine")}:{" "}
                <strong className="text-orange-500 dark:text-orange-400">
                  {formatK(debt.dineAmount)}
                </strong>
              </span>
            )}
            {debt.guestPlayAmount > 0 && (
              <span>
                🏸👤 {t("guestPlay")}:{" "}
                <strong className="text-primary">
                  {formatK(debt.guestPlayAmount)}
                </strong>
              </span>
            )}
            {debt.guestDineAmount > 0 && (
              <span>
                🍻👤 {t("guestDine")}:{" "}
                <strong className="text-orange-500 dark:text-orange-400">
                  {formatK(debt.guestDineAmount)}
                </strong>
              </span>
            )}
          </div>
        )}

        {/* Action buttons */}
        {onPayAction && isUnpaid && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowQR(true)}
              className="flex-1"
            >
              <QrCode className="mr-1 h-4 w-4" />
              Chuyển khoản
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={() => onPayAction(debt.id)}
              disabled={actionLoading}
              className="flex-1"
            >
              <CheckCircle className="mr-1 h-4 w-4" />
              {actionLabel ?? t("paid")}
            </Button>
          </div>
        )}
      </CardContent>

      {/* VietQR Payment Sheet */}
      {showQR && (
        <VietQRPayment
          amount={debt.totalAmount}
          memo={`FWBB S${debt.sessionId}`}
          onClose={() => setShowQR(false)}
          title="Thanh toán nợ"
          description={`Buổi ${formatSessionDate(debt.sessionDate)}`}
        />
      )}
    </Card>
  );
}

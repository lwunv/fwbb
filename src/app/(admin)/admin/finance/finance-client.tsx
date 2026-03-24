"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { type DebtCardData } from "@/components/finance/debt-card";
import { PaymentActions } from "@/components/finance/payment-actions";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { formatVND } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "lucide-react";
import { format } from "date-fns";
import { vi } from "date-fns/locale";

interface AdminFinanceClientProps {
  debts: DebtCardData[];
  totalOutstanding: number;
}

function formatSessionDate(dateStr: string) {
  try {
    const date = new Date(dateStr + "T00:00:00");
    return format(date, "dd/MM/yyyy (EEEE)", { locale: vi });
  } catch {
    return dateStr;
  }
}

export function AdminFinanceClient({ debts, totalOutstanding }: AdminFinanceClientProps) {
  const t = useTranslations("finance");

  return (
    <div className="space-y-4">
      {/* Total outstanding */}
      {totalOutstanding > 0 && (
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-sm text-muted-foreground">{t("outstandingDebt")}</div>
            <div className="text-2xl font-bold text-destructive mt-1">
              {formatVND(totalOutstanding)}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Debt list */}
      {debts.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          {t("noDebts")}
        </div>
      ) : (
        <div className="space-y-3">
          {debts.map((debt) => (
            <Card key={debt.id} size="sm">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <MemberAvatar memberId={debt.memberId} size={28} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {debt.memberName}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      {formatSessionDate(debt.sessionDate)}
                    </div>
                  </div>
                  <div className="text-sm font-bold">
                    {formatVND(debt.totalAmount)}
                  </div>
                </div>

                <div className="flex items-center justify-between border-t pt-2">
                  <div>
                    {debt.adminConfirmed ? (
                      <Badge variant="default">{t("adminConfirmed")}</Badge>
                    ) : debt.memberConfirmed ? (
                      <Badge variant="secondary">{t("waitingAdmin")}</Badge>
                    ) : (
                      <Badge variant="destructive">{t("unpaid")}</Badge>
                    )}
                  </div>
                  <PaymentActions
                    debtId={debt.id}
                    memberConfirmed={debt.memberConfirmed}
                    adminConfirmed={debt.adminConfirmed}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

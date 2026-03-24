"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { TimeFilter } from "@/components/shared/time-filter";
import { DebtCard, type DebtCardData } from "@/components/finance/debt-card";
import { PaymentActions } from "@/components/finance/payment-actions";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { formatVND } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Calendar, Wallet } from "lucide-react";
import { format } from "date-fns";
import { vi } from "date-fns/locale";

interface SummaryItem {
  memberId: number;
  memberName: string;
  totalOutstanding: number;
  totalPaid: number;
}

interface AdminFinanceClientProps {
  debts: DebtCardData[];
  summary: SummaryItem[];
}

function formatSessionDate(dateStr: string) {
  try {
    const date = new Date(dateStr + "T00:00:00");
    return format(date, "dd/MM", { locale: vi });
  } catch {
    return dateStr;
  }
}

export function AdminFinanceClient({ debts, summary }: AdminFinanceClientProps) {
  const [activeTab, setActiveTab] = useState<"summary" | "debts">("summary");
  const t = useTranslations("finance");
  const tStats = useTranslations("stats");

  const totalOutstanding = summary.reduce((sum, s) => sum + s.totalOutstanding, 0);

  return (
    <div className="space-y-4">
      {/* Total outstanding */}
      <Card>
        <CardContent className="p-4 text-center">
          <div className="text-sm text-muted-foreground">{t("outstandingDebt")}</div>
          <div className="text-2xl font-bold text-destructive mt-1">
            {formatVND(totalOutstanding)}
          </div>
        </CardContent>
      </Card>

      {/* Tab switcher */}
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        <button
          onClick={() => setActiveTab("summary")}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === "summary"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("byMember")}
        </button>
        <button
          onClick={() => setActiveTab("debts")}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === "debts"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("detail")}
        </button>
      </div>

      {/* Summary tab */}
      {activeTab === "summary" && (
        <div className="space-y-2">
          {summary.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              {tStats("noData")}
            </div>
          ) : (
            summary.map((s) => (
              <Card key={s.memberId} size="sm">
                <CardContent className="p-3 flex items-center gap-3">
                  <MemberAvatar memberId={s.memberId} size={36} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{s.memberName}</div>
                    <div className="flex gap-2 mt-0.5">
                      {s.totalOutstanding > 0 && (
                        <span className="text-xs text-destructive">
                          {t("owed")}: {formatVND(s.totalOutstanding)}
                        </span>
                      )}
                      {s.totalPaid > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {t("alreadyPaid")}: {formatVND(s.totalPaid)}
                        </span>
                      )}
                    </div>
                  </div>
                  {s.totalOutstanding > 0 ? (
                    <span className="text-sm font-bold text-destructive">
                      {formatVND(s.totalOutstanding)}
                    </span>
                  ) : (
                    <Badge variant="default">{t("noDebt")}</Badge>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Debts tab */}
      {activeTab === "debts" && (
        <div className="space-y-4">
          <TimeFilter />
          {debts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              {t("noDebts")}
            </div>
          ) : (
            <div className="space-y-3">
              {debts.map((debt) => (
                <Card key={debt.id} size="sm">
                  <CardContent className="p-3 space-y-2">
                    {/* Row 1: Member + date + amount */}
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

                    {/* Row 2: Breakdown */}
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {debt.playAmount > 0 && <span>{t("play")}: {formatVND(debt.playAmount)}</span>}
                      {debt.dineAmount > 0 && <span>{t("dine")}: {formatVND(debt.dineAmount)}</span>}
                      {debt.guestPlayAmount > 0 && (
                        <span>{t("guestPlay")}: {formatVND(debt.guestPlayAmount)}</span>
                      )}
                      {debt.guestDineAmount > 0 && (
                        <span>{t("guestDine")}: {formatVND(debt.guestDineAmount)}</span>
                      )}
                    </div>

                    {/* Row 3: Status + actions */}
                    <div className="flex items-center justify-between border-t pt-2">
                      <div className="flex items-center gap-2">
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
      )}
    </div>
  );
}

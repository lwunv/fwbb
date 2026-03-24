"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { type DebtCardData } from "@/components/finance/debt-card";
import { PaymentActions } from "@/components/finance/payment-actions";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { formatVND } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Calendar, ChevronDown, Search } from "lucide-react";
import { format } from "date-fns";
import { vi } from "date-fns/locale";

interface AdminFinanceClientProps {
  debts: DebtCardData[];
  totalOutstanding: number;
  memberPhones: Record<number, string>;
}

function formatSessionDate(dateStr: string) {
  try {
    const date = new Date(dateStr + "T00:00:00");
    return format(date, "dd/MM (EEEE)", { locale: vi });
  } catch {
    return dateStr;
  }
}

interface MemberGroup {
  memberId: number;
  memberName: string;
  phone: string;
  totalOwed: number;
  debts: DebtCardData[];
}

export function AdminFinanceClient({ debts, totalOutstanding, memberPhones }: AdminFinanceClientProps) {
  const t = useTranslations("finance");
  const tCommon = useTranslations("common");
  const [search, setSearch] = useState("");
  const [expandedMember, setExpandedMember] = useState<number | null>(null);

  // Group unpaid debts by member, sorted by total owed desc
  const unpaidDebts = debts.filter((d) => !d.adminConfirmed);
  const memberMap = new Map<number, MemberGroup>();

  for (const d of unpaidDebts) {
    if (!memberMap.has(d.memberId)) {
      memberMap.set(d.memberId, {
        memberId: d.memberId,
        memberName: d.memberName ?? "",
        phone: memberPhones[d.memberId] ?? "",
        totalOwed: 0,
        debts: [],
      });
    }
    const group = memberMap.get(d.memberId)!;
    group.totalOwed += d.totalAmount;
    group.debts.push(d);
  }

  let memberGroups = Array.from(memberMap.values())
    .sort((a, b) => b.totalOwed - a.totalOwed);

  // Search filter
  if (search) {
    const q = search.toLowerCase();
    memberGroups = memberGroups.filter(
      (g) => g.memberName.toLowerCase().includes(q) || g.phone.includes(search)
    );
  }

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
            <div className="text-xs text-muted-foreground mt-1">
              {memberGroups.length} người còn nợ
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder={`${tCommon("search")}...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-3 py-2 text-sm border rounded-md bg-background outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Member groups */}
      {memberGroups.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          {search ? "Không tìm thấy" : t("noDebts")}
        </div>
      ) : (
        <div className="space-y-2">
          {memberGroups.map((group) => {
            const isExpanded = expandedMember === group.memberId;
            return (
              <div key={group.memberId}>
                <Card size="sm">
                  <CardContent className="p-0">
                    <button
                      onClick={() => setExpandedMember(isExpanded ? null : group.memberId)}
                      className="w-full flex items-center gap-3 p-3 text-left hover:bg-accent/50 transition-colors"
                    >
                      <MemberAvatar memberId={group.memberId} size={32} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{group.memberName}</div>
                        <div className="text-xs text-muted-foreground">
                          {group.debts.length} buổi chưa thanh toán
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-sm font-bold text-destructive">
                          {formatVND(group.totalOwed)}
                        </div>
                      </div>
                      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform flex-shrink-0 ${isExpanded ? "rotate-180" : ""}`} />
                    </button>

                    {/* Expanded: individual debts */}
                    {isExpanded && (
                      <div className="border-t divide-y">
                        {group.debts.map((debt) => (
                          <div key={debt.id} className="px-3 py-2 space-y-1.5">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Calendar className="h-3 w-3" />
                                {formatSessionDate(debt.sessionDate)}
                              </div>
                              <span className="text-sm font-medium">{formatVND(debt.totalAmount)}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <div>
                                {debt.memberConfirmed ? (
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
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

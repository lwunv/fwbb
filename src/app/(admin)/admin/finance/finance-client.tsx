"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { type DebtCardData } from "@/components/finance/debt-card";
import { PaymentActions } from "@/components/finance/payment-actions";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { formatK } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { usePolling } from "@/lib/use-polling";
import { format } from "date-fns";
import { vi } from "date-fns/locale";

type DebtWithConfirmedAt = DebtCardData & { adminConfirmedAt?: string | null };

interface AdminFinanceClientProps {
  debts: DebtWithConfirmedAt[];
  totalOutstanding: number;
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
  memberAvatarKey: string | null;
  totalOwed: number;
  debts: DebtWithConfirmedAt[];
}

type Tab = "unpaid" | "paid";

export function AdminFinanceClient({ debts, totalOutstanding }: AdminFinanceClientProps) {
  const t = useTranslations("finance");
  const tCommon = useTranslations("common");
  usePolling();
  const [tab, setTab] = useState<Tab>("unpaid");
  const [search, setSearch] = useState("");
  const [expandedMember, setExpandedMember] = useState<number | null>(null);
  const [unpaidPage, setUnpaidPage] = useState(1);
  const [paidPage, setPaidPage] = useState(1);
  const [paidFilter, setPaidFilter] = useState<"all" | "waiting" | "confirmed">("all");
  const PAGE_SIZE = 20;

  // Group truly unpaid debts (not confirmed by member, not confirmed by admin)
  const unpaidDebts = debts.filter((d) => !d.adminConfirmed && !d.memberConfirmed);
  const memberMap = new Map<number, MemberGroup>();
  for (const d of unpaidDebts) {
    if (!memberMap.has(d.memberId)) {
      memberMap.set(d.memberId, {
        memberId: d.memberId,
        memberName: d.memberName ?? "",
        memberAvatarKey: d.memberAvatarKey ?? null,
        totalOwed: 0,
        debts: [],
      });
    }
    const group = memberMap.get(d.memberId)!;
    group.totalOwed += d.totalAmount;
    group.debts.push(d);
  }
  let memberGroups = Array.from(memberMap.values()).sort((a, b) => b.totalOwed - a.totalOwed);

  // Paid/waiting tab: admin confirmed + member confirmed (waiting admin)
  let paidDebts = debts
    .filter((d) => d.adminConfirmed || d.memberConfirmed)
    .sort((a, b) => {
      if (a.adminConfirmed !== b.adminConfirmed) return a.adminConfirmed ? 1 : -1;
      return (b.adminConfirmedAt ?? b.sessionDate).localeCompare(a.adminConfirmedAt ?? a.sessionDate);
    });

  // Search filter (applies to both tabs)
  if (search) {
    const q = search.toLowerCase();
    memberGroups = memberGroups.filter(
      (g) => g.memberName.toLowerCase().includes(q)
    );
    paidDebts = paidDebts.filter(
      (d) => (d.memberName ?? "").toLowerCase().includes(q)
    );
  }

  // Pagination — unpaid
  const unpaidTotalPages = Math.max(1, Math.ceil(memberGroups.length / PAGE_SIZE));
  const unpaidSafePage = Math.min(unpaidPage, unpaidTotalPages);
  const pagedUnpaid = memberGroups.slice((unpaidSafePage - 1) * PAGE_SIZE, unpaidSafePage * PAGE_SIZE);

  // Status filter — paid tab
  const filteredPaid = paidFilter === "all"
    ? paidDebts
    : paidFilter === "waiting"
      ? paidDebts.filter((d) => !d.adminConfirmed)
      : paidDebts.filter((d) => d.adminConfirmed);

  // Pagination — paid
  const paidTotalPages = Math.max(1, Math.ceil(filteredPaid.length / PAGE_SIZE));
  const paidSafePage = Math.min(paidPage, paidTotalPages);
  const pagedPaid = filteredPaid.slice((paidSafePage - 1) * PAGE_SIZE, paidSafePage * PAGE_SIZE);

  return (
    <div className="space-y-4">
      {/* Total outstanding */}
      {totalOutstanding > 0 && (
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-sm text-muted-foreground">{t("outstandingDebt")}</div>
            <div className="text-2xl font-bold text-destructive mt-1">
              {formatK(totalOutstanding)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {memberGroups.length} người còn nợ
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tab switcher */}
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        <button
          onClick={() => setTab("unpaid")}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            tab === "unpaid"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("unpaid")} ({unpaidDebts.length})
        </button>
        <button
          onClick={() => setTab("paid")}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            tab === "paid"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("recentPayments")}
        </button>
      </div>

      {/* Unpaid tab */}
      {tab === "unpaid" && (
        <>
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder={`${tCommon("search")}...`}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setUnpaidPage(1); }}
              className="w-full pl-10 pr-3 py-2 text-sm border rounded-md bg-background outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {pagedUnpaid.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              {search ? "Không tìm thấy" : t("noDebts")}
            </div>
          ) : (
            <div className="space-y-2">
              {pagedUnpaid.map((group) => {
                const isExpanded = expandedMember === group.memberId;
                return (
                  <Card key={group.memberId} size="sm">
                    <CardContent className="p-3 space-y-2">
                      {/* Member info + total */}
                      <div className="flex items-center gap-3">
                        <MemberAvatar memberId={group.memberId} avatarKey={group.memberAvatarKey} size={32} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{group.memberName}</div>
                          <div className="text-xs text-muted-foreground">
                            {group.debts.length} buổi
                          </div>
                        </div>
                        <span className="text-sm font-bold text-destructive">{formatK(group.totalOwed)}</span>
                        <button
                          type="button"
                          onClick={() => setExpandedMember(isExpanded ? null : group.memberId)}
                          className="flex items-center justify-center h-9 w-9 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
                        >
                          {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                        </button>
                      </div>

                      {/* Always visible: debt rows with date, amount, status, action */}
                      <div className="space-y-1.5 border-t pt-2">
                        {group.debts.map((debt) => (
                          <div key={debt.id}>
                            <div className="flex items-center justify-between gap-2 py-1">
                              <div className="flex items-center gap-2 min-w-0">
                                <div className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0">
                                  <Calendar className="h-3 w-3" />
                                  {formatSessionDate(debt.sessionDate)}
                                </div>
                                <span className="text-sm text-primary font-medium">{formatK(debt.totalAmount)}</span>
                                {debt.memberConfirmed ? (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-400 text-amber-600 dark:border-amber-600 dark:text-amber-400">{t("waitingAdmin")}</Badge>
                                ) : (
                                  <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{t("unpaid")}</Badge>
                                )}
                              </div>
                              <div className="flex-shrink-0">
                                <PaymentActions
                                  debtId={debt.id}
                                  memberConfirmed={debt.memberConfirmed}
                                  adminConfirmed={debt.adminConfirmed}
                                />
                              </div>
                            </div>
                            {/* Expandable: breakdown detail */}
                            {isExpanded && (
                              <div className="mb-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm">
                                {debt.playAmount > 0 && <span>🏸 cầu: <strong className="text-primary">{formatK(debt.playAmount)}</strong></span>}
                                {debt.dineAmount > 0 && <span>🍻 nhậu: <strong className="text-orange-500 dark:text-orange-400">{formatK(debt.dineAmount)}</strong></span>}
                                {debt.guestPlayAmount > 0 && <span>🏸 khách cầu: <strong className="text-primary">{formatK(debt.guestPlayAmount)}</strong></span>}
                                {debt.guestDineAmount > 0 && <span>🍻 khách nhậu: <strong className="text-orange-500 dark:text-orange-400">{formatK(debt.guestDineAmount)}</strong></span>}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
          {unpaidTotalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-4">
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={unpaidSafePage <= 1} onClick={() => setUnpaidPage(unpaidSafePage - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground">{unpaidSafePage} / {unpaidTotalPages}</span>
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={unpaidSafePage >= unpaidTotalPages} onClick={() => setUnpaidPage(unpaidSafePage + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}

      {/* Paid tab */}
      {tab === "paid" && (
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder={`${tCommon("search")}...`}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPaidPage(1); }}
              className="w-full pl-10 pr-3 py-2 text-sm border rounded-md bg-background outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          {/* Status filter */}
          <div className="flex gap-1.5">
            {([
              { key: "all" as const, label: t("allStatus") },
              { key: "waiting" as const, label: t("waitingAdmin") },
              { key: "confirmed" as const, label: t("confirmed") },
            ]).map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => { setPaidFilter(key); setPaidPage(1); }}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  paidFilter === key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {pagedPaid.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              {t("noPayments")}
            </div>
          ) : (
            pagedPaid.map((debt) => (
              <Card key={debt.id} size="sm">
                <CardContent className="p-3 flex items-center gap-3">
                  <MemberAvatar memberId={debt.memberId} avatarKey={debt.memberAvatarKey} size={28} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{debt.memberName}</div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      {formatSessionDate(debt.sessionDate)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-sm font-medium ${debt.adminConfirmed ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}>
                      {formatK(debt.totalAmount)}
                    </span>
                    {!debt.adminConfirmed && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-400 text-amber-600 dark:border-amber-600 dark:text-amber-400">{t("waitingAdmin")}</Badge>
                    )}
                    <PaymentActions
                      debtId={debt.id}
                      memberConfirmed={debt.memberConfirmed}
                      adminConfirmed={debt.adminConfirmed}
                    />
                  </div>
                </CardContent>
              </Card>
            ))
          )}
          {paidTotalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-4">
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={paidSafePage <= 1} onClick={() => setPaidPage(paidSafePage - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground">{paidSafePage} / {paidTotalPages}</span>
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={paidSafePage >= paidTotalPages} onClick={() => setPaidPage(paidSafePage + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

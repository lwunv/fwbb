"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { type DebtCardData } from "@/components/finance/debt-card";
import { PaymentActions } from "@/components/finance/payment-actions";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { formatK } from "@/lib/utils";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Search,
  Users,
} from "lucide-react";
import { usePolling } from "@/lib/use-polling";
import { formatSessionDate } from "@/lib/date-format";
import type { AppLocale } from "@/lib/date-fns-locale";

type DebtWithConfirmedAt = DebtCardData & { adminConfirmedAt?: string | null };

interface AdminFinanceClientProps {
  debts: DebtWithConfirmedAt[];
  totalOutstanding: number;
}

interface MemberGroup {
  memberId: number;
  memberName: string;
  memberAvatarKey: string | null;
  memberAvatarUrl: string | null;
  totalOwed: number;
  debts: DebtWithConfirmedAt[];
}

type Tab = "unpaid" | "paid";

export function AdminFinanceClient({
  debts,
  totalOutstanding,
}: AdminFinanceClientProps) {
  const t = useTranslations("finance");
  const tCommon = useTranslations("common");
  const locale = useLocale() as AppLocale;
  const fmtDate = (d: string) => formatSessionDate(d, "weekday", locale);
  usePolling();
  const [tab, setTab] = useState<Tab>("unpaid");
  const [search, setSearch] = useState("");
  const [expandedMember, setExpandedMember] = useState<number | null>(null);
  const [unpaidPage, setUnpaidPage] = useState(1);
  const [paidPage, setPaidPage] = useState(1);
  const [paidFilter, setPaidFilter] = useState<"all" | "waiting" | "confirmed">(
    "all",
  );
  const PAGE_SIZE = 20;

  // Group truly unpaid debts (not confirmed by member, not confirmed by admin)
  const unpaidDebts = debts.filter(
    (d) => !d.adminConfirmed && !d.memberConfirmed,
  );
  const memberMap = new Map<number, MemberGroup>();
  for (const d of unpaidDebts) {
    if (!memberMap.has(d.memberId)) {
      memberMap.set(d.memberId, {
        memberId: d.memberId,
        memberName: d.memberName ?? "",
        memberAvatarKey: d.memberAvatarKey ?? null,
        memberAvatarUrl: d.memberAvatarUrl ?? null,
        totalOwed: 0,
        debts: [],
      });
    }
    const group = memberMap.get(d.memberId)!;
    group.totalOwed += d.totalAmount;
    group.debts.push(d);
  }
  let memberGroups = Array.from(memberMap.values()).sort(
    (a, b) => b.totalOwed - a.totalOwed,
  );

  // Paid/waiting tab: admin confirmed + member confirmed (waiting admin)
  let paidDebts = debts
    .filter((d) => d.adminConfirmed || d.memberConfirmed)
    .sort((a, b) => {
      if (a.adminConfirmed !== b.adminConfirmed)
        return a.adminConfirmed ? 1 : -1;
      return (b.adminConfirmedAt ?? b.sessionDate).localeCompare(
        a.adminConfirmedAt ?? a.sessionDate,
      );
    });

  // Search filter (applies to both tabs)
  if (search) {
    const q = search.toLowerCase();
    memberGroups = memberGroups.filter((g) =>
      g.memberName.toLowerCase().includes(q),
    );
    paidDebts = paidDebts.filter((d) =>
      (d.memberName ?? "").toLowerCase().includes(q),
    );
  }

  // Pagination — unpaid
  const unpaidTotalPages = Math.max(
    1,
    Math.ceil(memberGroups.length / PAGE_SIZE),
  );
  const unpaidSafePage = Math.min(unpaidPage, unpaidTotalPages);
  const pagedUnpaid = memberGroups.slice(
    (unpaidSafePage - 1) * PAGE_SIZE,
    unpaidSafePage * PAGE_SIZE,
  );

  // Status filter — paid tab
  const filteredPaid =
    paidFilter === "all"
      ? paidDebts
      : paidFilter === "waiting"
        ? paidDebts.filter((d) => !d.adminConfirmed)
        : paidDebts.filter((d) => d.adminConfirmed);

  // Pagination — paid
  const paidTotalPages = Math.max(
    1,
    Math.ceil(filteredPaid.length / PAGE_SIZE),
  );
  const paidSafePage = Math.min(paidPage, paidTotalPages);
  const pagedPaid = filteredPaid.slice(
    (paidSafePage - 1) * PAGE_SIZE,
    paidSafePage * PAGE_SIZE,
  );

  return (
    <div className="space-y-4">
      <Link
        href="/admin/finance/members"
        className="border-border bg-card/80 hover:bg-accent flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border px-4 py-3 text-base font-medium shadow-sm backdrop-blur transition-colors"
      >
        <Users className="h-5 w-5 shrink-0" aria-hidden />
        {t("memberSummaryTitle")}
      </Link>

      {/* Total outstanding */}
      {totalOutstanding > 0 && (
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-muted-foreground text-base">
              {t("outstandingDebt")}
            </div>
            <div className="text-destructive mt-1 text-2xl font-bold">
              {formatK(totalOutstanding)}
            </div>
            <div className="text-muted-foreground mt-1 text-sm">
              {t("peopleStillOwed", { count: memberGroups.length })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tab switcher */}
      <div className="bg-muted flex gap-1 rounded-xl p-1.5">
        <button
          type="button"
          onClick={() => setTab("unpaid")}
          className={`min-h-11 flex-1 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
            tab === "unpaid"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("unpaid")} ({unpaidDebts.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("paid")}
          className={`min-h-11 flex-1 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
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
            <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <input
              type="text"
              placeholder={`${tCommon("search")}...`}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setUnpaidPage(1);
              }}
              className="bg-background focus:ring-primary h-12 w-full rounded-xl border pr-4 pl-11 text-base outline-none focus:ring-1"
            />
          </div>

          {pagedUnpaid.length === 0 ? (
            <div className="text-muted-foreground py-8 text-center text-base">
              {search ? t("notFound") : t("noDebts")}
            </div>
          ) : (
            <div className="space-y-2">
              {pagedUnpaid.map((group) => {
                const isExpanded = expandedMember === group.memberId;
                return (
                  <Card key={group.memberId} size="sm">
                    <CardContent className="space-y-2 p-4">
                      {/* Member info + total */}
                      <div className="flex items-center gap-3">
                        <MemberAvatar
                          memberId={group.memberId}
                          avatarKey={group.memberAvatarKey}
                          avatarUrl={group.memberAvatarUrl}
                          size={36}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-base font-medium">
                            {group.memberName}
                          </div>
                          <div className="text-muted-foreground text-sm">
                            {t("owedSessionCount", {
                              count: group.debts.length,
                            })}
                          </div>
                        </div>
                        <span className="text-destructive text-base font-bold">
                          {formatK(group.totalOwed)}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedMember(
                              isExpanded ? null : group.memberId,
                            )
                          }
                          className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-11 shrink-0 items-center justify-center rounded-xl transition-colors"
                        >
                          {isExpanded ? (
                            <ChevronUp className="h-5 w-5" />
                          ) : (
                            <ChevronDown className="h-5 w-5" />
                          )}
                        </button>
                      </div>

                      {/* Always visible: debt rows with date, amount, status, action */}
                      <div className="space-y-1.5 border-t pt-2">
                        {group.debts.map((debt) => (
                          <div key={debt.id}>
                            <div className="flex items-center justify-between gap-2 py-1">
                              <div className="flex min-w-0 items-center gap-2">
                                <div className="text-muted-foreground flex flex-shrink-0 items-center gap-2 text-sm">
                                  <Calendar className="h-4 w-4" />
                                  {fmtDate(debt.sessionDate)}
                                </div>
                                <span className="text-primary text-base font-medium">
                                  {formatK(debt.totalAmount)}
                                </span>
                                {debt.memberConfirmed ? (
                                  <StatusBadge variant="waiting">
                                    {t("waitingAdmin")}
                                  </StatusBadge>
                                ) : (
                                  <StatusBadge variant="unpaid">
                                    {t("unpaid")}
                                  </StatusBadge>
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
                              <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-base">
                                {debt.playAmount > 0 && (
                                  <span>
                                    <span aria-hidden>🏸</span> {t("play")}:{" "}
                                    <strong className="text-primary tabular-nums">
                                      {formatK(debt.playAmount)}
                                    </strong>
                                  </span>
                                )}
                                {debt.dineAmount > 0 && (
                                  <span>
                                    <span aria-hidden>🍻</span> {t("dine")}:{" "}
                                    <strong className="text-orange-500 tabular-nums dark:text-orange-400">
                                      {formatK(debt.dineAmount)}
                                    </strong>
                                  </span>
                                )}
                                {debt.guestPlayAmount > 0 && (
                                  <span>
                                    <span aria-hidden>🏸</span> {t("guestPlay")}
                                    :{" "}
                                    <strong className="text-primary tabular-nums">
                                      {formatK(debt.guestPlayAmount)}
                                    </strong>
                                  </span>
                                )}
                                {debt.guestDineAmount > 0 && (
                                  <span>
                                    <span aria-hidden>🍻</span> {t("guestDine")}
                                    :{" "}
                                    <strong className="text-orange-500 tabular-nums dark:text-orange-400">
                                      {formatK(debt.guestDineAmount)}
                                    </strong>
                                  </span>
                                )}
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
            <div className="mt-4 flex items-center justify-center gap-3">
              <Button
                variant="outline"
                size="icon"
                disabled={unpaidSafePage <= 1}
                onClick={() => setUnpaidPage(unpaidSafePage - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-muted-foreground text-base">
                {unpaidSafePage} / {unpaidTotalPages}
              </span>
              <Button
                variant="outline"
                size="icon"
                disabled={unpaidSafePage >= unpaidTotalPages}
                onClick={() => setUnpaidPage(unpaidSafePage + 1)}
              >
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
            <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <input
              type="text"
              placeholder={`${tCommon("search")}...`}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPaidPage(1);
              }}
              className="bg-background focus:ring-primary h-12 w-full rounded-xl border pr-4 pl-11 text-base outline-none focus:ring-1"
            />
          </div>
          {/* Status filter */}
          <div className="flex gap-1.5">
            {[
              { key: "all" as const, label: t("allStatus") },
              { key: "waiting" as const, label: t("waitingAdmin") },
              { key: "confirmed" as const, label: t("confirmed") },
            ].map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setPaidFilter(key);
                  setPaidPage(1);
                }}
                className={`min-h-11 rounded-xl px-3 py-2 text-sm font-medium transition-colors sm:px-4 ${
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
            <div className="text-muted-foreground py-8 text-center text-sm">
              {t("noPayments")}
            </div>
          ) : (
            pagedPaid.map((debt) => (
              <Card key={debt.id} size="sm">
                <CardContent className="flex items-center gap-3 p-4">
                  <MemberAvatar
                    memberId={debt.memberId}
                    avatarKey={debt.memberAvatarKey}
                    avatarUrl={debt.memberAvatarUrl}
                    size={36}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-medium">
                      {debt.memberName}
                    </div>
                    <div className="text-muted-foreground flex items-center gap-2 text-sm">
                      <Calendar className="h-4 w-4" />
                      {fmtDate(debt.sessionDate)}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <span
                      className={`text-base font-medium ${debt.adminConfirmed ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}
                    >
                      {formatK(debt.totalAmount)}
                    </span>
                    {!debt.adminConfirmed && (
                      <StatusBadge variant="waiting">
                        {t("waitingAdmin")}
                      </StatusBadge>
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
            <div className="mt-4 flex items-center justify-center gap-3">
              <Button
                variant="outline"
                size="icon"
                disabled={paidSafePage <= 1}
                onClick={() => setPaidPage(paidSafePage - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-muted-foreground text-base">
                {paidSafePage} / {paidTotalPages}
              </span>
              <Button
                variant="outline"
                size="icon"
                disabled={paidSafePage >= paidTotalPages}
                onClick={() => setPaidPage(paidSafePage + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

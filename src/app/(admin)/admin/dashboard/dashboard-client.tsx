"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { formatSessionDate } from "@/lib/date-format";
import type { AppLocale } from "@/lib/date-fns-locale";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { Input } from "@/components/ui/input";
import { formatK } from "@/lib/utils";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { PaymentActions } from "@/components/finance/payment-actions";
import { updateAppName } from "@/actions/settings";
import { fireAction } from "@/lib/optimistic-action";
import { usePolling } from "@/lib/use-polling";
import {
  Wallet,
  AlertTriangle,
  Users,
  CalendarDays,
  ArrowRight,
  Clock,
  MapPin,
  Navigation,
  Package,
  Pencil,
  Check,
  Calendar,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface UpcomingSession {
  id: number;
  date: string;
  status: string;
  courtName: string | null;
  courtMapLink: string | null;
  startTime: string;
  endTime: string;
  playerCount: number;
  dinerCount: number;
  guestPlayCount: number;
  guestDineCount: number;
}

interface RecentPayment {
  id: number;
  memberId: number;
  memberAvatarKey: string | null;
  memberAvatarUrl: string | null;
  memberName: string;
  sessionDate: string;
  amount: number;
  confirmedAt: string;
  memberConfirmed: boolean;
  adminConfirmed: boolean;
}

interface UnpaidDebt {
  id: number;
  sessionDate: string;
  totalAmount: number;
  memberConfirmed: boolean;
  adminConfirmed: boolean;
  playAmount: number;
  dineAmount: number;
  guestPlayAmount: number;
  guestDineAmount: number;
}

interface UnpaidGroup {
  memberId: number;
  memberName: string;
  memberAvatarKey: string | null;
  memberAvatarUrl: string | null;
  totalOwed: number;
  debts: UnpaidDebt[];
}

type FinanceTab = "recent" | "unpaid";

interface DashboardClientProps {
  appName?: string;
  totalOutstanding: number;
  totalStockQua: number;
  activeMembersCount: number;
  sessionsThisMonth: number;
  upcomingSession: UpcomingSession | null;
  recentPayments: RecentPayment[];
  unpaidGroups: UnpaidGroup[];
}

export function DashboardClient({
  appName = "FWBB",
  totalOutstanding,
  totalStockQua,
  activeMembersCount,
  sessionsThisMonth,
  upcomingSession,
  recentPayments,
  unpaidGroups,
}: DashboardClientProps) {
  const tf = useTranslations("finance");
  const td = useTranslations("dashboard");
  const ts = useTranslations("sessions");
  const locale = useLocale() as AppLocale;
  const formatDateShort = (d: string) => formatSessionDate(d, "short", locale);
  const formatDateFull = (d: string) =>
    formatSessionDate(d, "weekdayLong", locale);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(appName);
  const [saved, setSaved] = useState(false);
  const [financeTab, setFinanceTab] = useState<FinanceTab>("recent");
  const [expandedMember, setExpandedMember] = useState<number | null>(null);
  usePolling();

  return (
    <div className="space-y-6">
      {/* App Name Editor */}
      <div className="flex items-center gap-3">
        {editingName ? (
          <form
            className="flex items-center gap-2"
            action={() => {
              setEditingName(false);
              setSaved(true);
              setTimeout(() => setSaved(false), 2000);
              fireAction(
                () => updateAppName(nameValue),
                () => {
                  setEditingName(true);
                  setSaved(false);
                },
              );
            }}
          >
            <Input
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              className="w-48"
              autoFocus
            />
            <Button type="submit" size="sm" variant="outline">
              <Check className="h-4 w-4" />
            </Button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setEditingName(true)}
            className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-base transition-colors"
          >
            <span>
              {td("appName")}:{" "}
              <strong className="text-foreground">{appName}</strong>
            </span>
            <Pencil className="h-4 w-4" />
          </button>
        )}
        {saved && (
          <span className="text-xs text-green-600">{td("appNameSaved")}</span>
        )}
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          icon={Wallet}
          iconClassName="bg-destructive/10 text-destructive"
          label={tf("outstandingDebt")}
          value={formatK(totalOutstanding)}
          href="/admin/finance"
        />

        <StatCard
          icon={Package}
          iconClassName={
            totalStockQua < 12
              ? "bg-red-500/10 text-red-500"
              : totalStockQua <= 40
                ? "bg-amber-500/10 text-amber-500"
                : "bg-green-500/10 text-green-500"
          }
          label={tf("shuttleStock")}
          value={
            <span
              className={
                totalStockQua < 12
                  ? "text-red-600"
                  : totalStockQua <= 40
                    ? "text-amber-600"
                    : "text-green-600"
              }
            >
              {totalStockQua} quả
            </span>
          }
          href="/admin/inventory"
        />

        <StatCard
          icon={Users}
          iconClassName="bg-primary/10 text-primary"
          label={td("members")}
          value={activeMembersCount}
          href="/admin/members"
        />

        <StatCard
          icon={CalendarDays}
          iconClassName="bg-accent/10 text-accent"
          label={td("sessionsThisMonth")}
          value={sessionsThisMonth}
          href="/admin/sessions"
        />
      </div>

      {/* Low stock warning detail */}
      {totalStockQua < 12 && (
        <Card className="border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                <span className="text-sm">
                  ⚠ Cầu sắp hết! Còn <strong>{totalStockQua} quả</strong> — mua
                  thêm cầu!
                </span>
              </div>
              <Link href="/admin/inventory">
                <Button variant="ghost" size="sm">
                  {tf("view")}
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upcoming Session */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>{td("upcomingSession")}</span>
            {upcomingSession && (
              <Badge
                variant="outline"
                className={
                  upcomingSession.status === "voting"
                    ? "border-green-500 text-green-600 dark:border-green-600 dark:text-green-400"
                    : upcomingSession.status === "confirmed"
                      ? "border-green-500 text-green-600 dark:border-green-600 dark:text-green-400"
                      : upcomingSession.status === "completed"
                        ? "border-blue-500 text-blue-600 dark:border-blue-600 dark:text-blue-400"
                        : "border-destructive text-destructive"
                }
              >
                {ts(
                  upcomingSession.status as
                    | "voting"
                    | "confirmed"
                    | "completed"
                    | "cancelled",
                )}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {upcomingSession ? (
            <div className="space-y-3">
              <div className="space-y-2.5">
                <div className="flex items-center gap-3 text-base">
                  <CalendarDays className="text-muted-foreground h-5 w-5" />
                  <span className="font-medium capitalize">
                    {formatDateFull(upcomingSession.date)}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-base">
                  <Clock className="text-muted-foreground h-5 w-5" />
                  <span>
                    {upcomingSession.startTime} - {upcomingSession.endTime}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-base">
                  <MapPin className="text-muted-foreground h-5 w-5" />
                  <span>
                    {upcomingSession.courtName || td("courtNotSelected")}
                  </span>
                  {upcomingSession.courtMapLink && (
                    <a
                      href={upcomingSession.courtMapLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary inline-flex items-center gap-1 text-sm hover:underline"
                    >
                      <Navigation className="h-4 w-4" /> Chỉ đường
                    </a>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1.5 pt-1 text-base">
                  <span>
                    🏸 {ts("badminton")}:{" "}
                    <strong className="text-primary">
                      {upcomingSession.playerCount +
                        upcomingSession.guestPlayCount}
                    </strong>{" "}
                    {ts("people")}
                    {upcomingSession.guestPlayCount > 0 && (
                      <span className="tabular-nums">
                        {" "}
                        ({upcomingSession.guestPlayCount} {ts("guest")})
                      </span>
                    )}
                  </span>
                  <span>
                    🍻 {ts("dining")}:{" "}
                    <strong className="text-orange-500 dark:text-orange-400">
                      {upcomingSession.dinerCount +
                        upcomingSession.guestDineCount}
                    </strong>{" "}
                    {ts("people")}
                    {upcomingSession.guestDineCount > 0 && (
                      <span className="tabular-nums">
                        {" "}
                        ({upcomingSession.guestDineCount} {ts("guest")})
                      </span>
                    )}
                  </span>
                </div>
              </div>
              <Link href={`/admin/sessions/${upcomingSession.id}`}>
                <Button size="lg" className="w-full">
                  {td("manageSession")}
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </Link>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">{td("noUpcoming")}</p>
          )}
        </CardContent>
      </Card>

      {/* Finance — tabbed: Recent Payments + Unpaid */}
      <Card>
        <CardContent className="space-y-3">
          {/* Tab switcher */}
          <div className="bg-muted flex gap-1 rounded-xl p-1.5">
            <button
              onClick={() => setFinanceTab("recent")}
              className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
                financeTab === "recent"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tf("recentPayments")}
            </button>
            <button
              onClick={() => setFinanceTab("unpaid")}
              className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
                financeTab === "unpaid"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tf("unpaid")} (
              {unpaidGroups.reduce((s, g) => s + g.debts.length, 0)})
            </button>
          </div>

          {/* Recent Payments tab */}
          {financeTab === "recent" &&
            (recentPayments.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {tf("noPayments")}
              </p>
            ) : (
              <div className="space-y-2">
                {recentPayments.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-2 border-b py-1.5 last:border-0"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <MemberAvatar
                        memberId={p.memberId}
                        avatarKey={p.memberAvatarKey}
                        avatarUrl={p.memberAvatarUrl}
                        size={32}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-base font-medium">
                          {p.memberName}
                        </p>
                        <p className="text-muted-foreground text-sm">
                          {tf("session")} {formatDateShort(p.sessionDate)}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={`text-sm font-medium ${p.adminConfirmed ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}
                      >
                        {formatK(p.amount)}
                      </span>
                      {!p.adminConfirmed && (
                        <StatusBadge variant="waiting">
                          {tf("waitingAdmin")}
                        </StatusBadge>
                      )}
                      <PaymentActions
                        debtId={p.id}
                        memberConfirmed={p.memberConfirmed}
                        adminConfirmed={p.adminConfirmed}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ))}

          {/* Unpaid tab */}
          {financeTab === "unpaid" &&
            (unpaidGroups.length === 0 ? (
              <p className="text-muted-foreground text-sm">{tf("noDebts")}</p>
            ) : (
              <div className="space-y-2">
                {unpaidGroups.map((group) => {
                  const isExpanded = expandedMember === group.memberId;
                  return (
                    <div
                      key={group.memberId}
                      className="space-y-2 rounded-lg border p-3"
                    >
                      {/* Member row */}
                      <div className="flex items-center gap-3">
                        <MemberAvatar
                          memberId={group.memberId}
                          avatarKey={group.memberAvatarKey}
                          avatarUrl={group.memberAvatarUrl}
                          size={32}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-base font-medium">
                            {group.memberName}
                          </div>
                          <div className="text-muted-foreground text-sm">
                            {group.debts.length} buổi
                          </div>
                        </div>
                        <span className="text-destructive text-sm font-bold">
                          {formatK(group.totalOwed)}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedMember(
                              isExpanded ? null : group.memberId,
                            )
                          }
                          className="text-muted-foreground hover:bg-accent hover:text-foreground flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors"
                        >
                          {isExpanded ? (
                            <ChevronUp className="h-5 w-5" />
                          ) : (
                            <ChevronDown className="h-5 w-5" />
                          )}
                        </button>
                      </div>

                      {/* Expanded: debt detail rows */}
                      {isExpanded && (
                        <div className="space-y-1.5 border-t pt-2">
                          {group.debts.map((debt) => (
                            <div key={debt.id}>
                              <div className="flex items-center justify-between gap-2 py-1">
                                <div className="flex min-w-0 items-center gap-2">
                                  <div className="text-muted-foreground flex flex-shrink-0 items-center gap-1 text-xs">
                                    <Calendar className="h-4 w-4" />
                                    {formatDateShort(debt.sessionDate)}
                                  </div>
                                  <span className="text-primary text-base font-medium">
                                    {formatK(debt.totalAmount)}
                                  </span>
                                  {debt.memberConfirmed ? (
                                    <StatusBadge variant="waiting">
                                      {tf("waitingAdmin")}
                                    </StatusBadge>
                                  ) : (
                                    <StatusBadge variant="unpaid">
                                      {tf("unpaid")}
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
                              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm">
                                {debt.playAmount > 0 && (
                                  <span>
                                    🏸 cầu:{" "}
                                    <strong className="text-primary">
                                      {formatK(debt.playAmount)}
                                    </strong>
                                  </span>
                                )}
                                {debt.dineAmount > 0 && (
                                  <span>
                                    🍻 nhậu:{" "}
                                    <strong className="text-orange-500 dark:text-orange-400">
                                      {formatK(debt.dineAmount)}
                                    </strong>
                                  </span>
                                )}
                                {debt.guestPlayAmount > 0 && (
                                  <span>
                                    🏸 khách cầu:{" "}
                                    <strong className="text-primary">
                                      {formatK(debt.guestPlayAmount)}
                                    </strong>
                                  </span>
                                )}
                                {debt.guestDineAmount > 0 && (
                                  <span>
                                    🍻 khách nhậu:{" "}
                                    <strong className="text-orange-500 dark:text-orange-400">
                                      {formatK(debt.guestDineAmount)}
                                    </strong>
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
        </CardContent>
      </Card>
    </div>
  );
}

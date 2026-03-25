"use client";

import { useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { vi } from "date-fns/locale";
import { useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatK } from "@/lib/utils";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { PaymentActions } from "@/components/finance/payment-actions";
import { updateAppName } from "@/actions/settings";
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

function formatDateShort(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "dd/MM", { locale: vi });
  } catch {
    return dateStr;
  }
}

function formatDateFull(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "EEEE, dd/MM/yyyy", { locale: vi });
  } catch {
    return dateStr;
  }
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
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(appName);
  const [saved, setSaved] = useState(false);
  const [financeTab, setFinanceTab] = useState<FinanceTab>("recent");
  const [expandedMember, setExpandedMember] = useState<number | null>(null);
  usePolling();

  return (
    <div className="space-y-6">
      {/* App Name Editor */}
      <div className="flex items-center gap-2">
        {editingName ? (
          <form
            className="flex items-center gap-2"
            action={async () => {
              await updateAppName(nameValue);
              setEditingName(false);
              setSaved(true);
              setTimeout(() => setSaved(false), 2000);
            }}
          >
            <Input
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              className="h-8 w-48 text-sm"
              autoFocus
            />
            <Button type="submit" size="sm" variant="outline" className="h-8 gap-1">
              <Check className="h-3.5 w-3.5" />
            </Button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setEditingName(true)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>{td("appName")}: <strong className="text-foreground">{appName}</strong></span>
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        {saved && <span className="text-xs text-green-600">{td("appNameSaved")}</span>}
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card size="sm">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-destructive/10 p-2">
                <Wallet className="h-4 w-4 text-destructive" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground truncate">
                  {tf("outstandingDebt")}
                </p>
                <p className="text-sm font-bold">
                  {formatK(totalOutstanding)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className={`rounded-lg p-2 ${
                totalStockQua < 12 ? "bg-red-500/10" : totalStockQua <= 40 ? "bg-amber-500/10" : "bg-green-500/10"
              }`}>
                <Package className={`h-4 w-4 ${
                  totalStockQua < 12 ? "text-red-500" : totalStockQua <= 40 ? "text-amber-500" : "text-green-500"
                }`} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground truncate">
                  {tf("shuttleStock")}
                </p>
                <p className={`text-sm font-bold ${
                  totalStockQua < 12 ? "text-red-600" : totalStockQua <= 40 ? "text-amber-600" : "text-green-600"
                }`}>
                  {totalStockQua} quả
                </p>
              </div>
            </div>
            {totalStockQua < 12 && (
              <p className="text-xs text-red-500 mt-1">⚠ Mua thêm cầu!</p>
            )}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-primary/10 p-2">
                <Users className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground truncate">
                  {td("members")}
                </p>
                <p className="text-sm font-bold">{activeMembersCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-accent/10 p-2">
                <CalendarDays className="h-4 w-4 text-accent" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground truncate">
                  {td("sessionsThisMonth")}
                </p>
                <p className="text-sm font-bold">{sessionsThisMonth}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Low stock warning detail */}
      {totalStockQua < 12 && (
        <Card className="border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                <span className="text-sm">
                  ⚠ Cầu sắp hết! Còn <strong>{totalStockQua} quả</strong> — mua thêm cầu!
                </span>
              </div>
              <Link href="/admin/inventory">
                <Button variant="ghost" size="sm">
                  {tf("view")}
                  <ArrowRight className="h-3 w-3 ml-1" />
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
              <Badge variant="outline" className={
                upcomingSession.status === "voting" ? "border-green-500 text-green-600 dark:border-green-600 dark:text-green-400" :
                upcomingSession.status === "confirmed" ? "border-green-500 text-green-600 dark:border-green-600 dark:text-green-400" :
                upcomingSession.status === "completed" ? "border-blue-500 text-blue-600 dark:border-blue-600 dark:text-blue-400" :
                "border-destructive text-destructive"
              }>{ts(upcomingSession.status as "voting" | "confirmed" | "completed" | "cancelled")}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {upcomingSession ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-sm">
                  <CalendarDays className="h-4 w-4 text-muted-foreground" />
                  <span className="capitalize">
                    {formatDateFull(upcomingSession.date)}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span>
                    {upcomingSession.startTime} - {upcomingSession.endTime}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span>
                    {upcomingSession.courtName || td("courtNotSelected")}
                  </span>
                  {upcomingSession.courtMapLink && (
                    <a
                      href={upcomingSession.courtMapLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary text-xs hover:underline"
                    >
                      <Navigation className="h-3 w-3 inline" /> Chỉ đường
                    </a>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm pt-1">
                  <span>
                    🏸 {ts("badminton")}:{" "}
                    <strong className="text-primary">{upcomingSession.playerCount + upcomingSession.guestPlayCount}</strong> {ts("people")}
                    {upcomingSession.guestPlayCount > 0 && (
                      <span className="tabular-nums">
                        {" "}
                        ({upcomingSession.guestPlayCount}{ts("guest")})
                      </span>
                    )}
                  </span>
                  <span>
                    🍻 {ts("dining")}:{" "}
                    <strong className="text-orange-500 dark:text-orange-400">{upcomingSession.dinerCount + upcomingSession.guestDineCount}</strong> {ts("people")}
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
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </Link>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {td("noUpcoming")}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Finance — tabbed: Recent Payments + Unpaid */}
      <Card>
        <CardContent className="space-y-3">
          {/* Tab switcher */}
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            <button
              onClick={() => setFinanceTab("recent")}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                financeTab === "recent"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tf("recentPayments")}
            </button>
            <button
              onClick={() => setFinanceTab("unpaid")}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                financeTab === "unpaid"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tf("unpaid")} ({unpaidGroups.reduce((s, g) => s + g.debts.length, 0)})
            </button>
          </div>

          {/* Recent Payments tab */}
          {financeTab === "recent" && (
            recentPayments.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {tf("noPayments")}
              </p>
            ) : (
              <div className="space-y-2">
                {recentPayments.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-2 py-1.5 border-b last:border-0"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <MemberAvatar memberId={p.memberId} avatarKey={p.memberAvatarKey} size={24} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {p.memberName}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {tf("session")} {formatDateShort(p.sessionDate)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-sm font-medium ${p.adminConfirmed ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}>
                        {formatK(p.amount)}
                      </span>
                      {!p.adminConfirmed && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-400 text-amber-600 dark:border-amber-600 dark:text-amber-400">{tf("waitingAdmin")}</Badge>
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
            )
          )}

          {/* Unpaid tab */}
          {financeTab === "unpaid" && (
            unpaidGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {tf("noDebts")}
              </p>
            ) : (
              <div className="space-y-2">
                {unpaidGroups.map((group) => {
                  const isExpanded = expandedMember === group.memberId;
                  return (
                    <div key={group.memberId} className="border rounded-lg p-3 space-y-2">
                      {/* Member row */}
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

                      {/* Expanded: debt detail rows */}
                      {isExpanded && (
                        <div className="space-y-1.5 border-t pt-2">
                          {group.debts.map((debt) => (
                            <div key={debt.id}>
                              <div className="flex items-center justify-between gap-2 py-1">
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0">
                                    <Calendar className="h-3 w-3" />
                                    {formatDateShort(debt.sessionDate)}
                                  </div>
                                  <span className="text-sm text-primary font-medium">{formatK(debt.totalAmount)}</span>
                                  {debt.memberConfirmed ? (
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-400 text-amber-600 dark:border-amber-600 dark:text-amber-400">{tf("waitingAdmin")}</Badge>
                                  ) : (
                                    <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{tf("unpaid")}</Badge>
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
                                {debt.playAmount > 0 && <span>🏸 cầu: <strong className="text-primary">{formatK(debt.playAmount)}</strong></span>}
                                {debt.dineAmount > 0 && <span>🍻 nhậu: <strong className="text-orange-500 dark:text-orange-400">{formatK(debt.dineAmount)}</strong></span>}
                                {debt.guestPlayAmount > 0 && <span>🏸 khách cầu: <strong className="text-primary">{formatK(debt.guestPlayAmount)}</strong></span>}
                                {debt.guestDineAmount > 0 && <span>🍻 khách nhậu: <strong className="text-orange-500 dark:text-orange-400">{formatK(debt.guestDineAmount)}</strong></span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
}

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
import { StatCard } from "@/components/shared/stat-card";
import { Input } from "@/components/ui/input";
import { formatK, cn } from "@/lib/utils";
import { MemberAvatar } from "@/components/shared/member-avatar";
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
  X,
  TrendingUp,
  TrendingDown,
  Receipt,
  ShoppingBag,
  Landmark,
  Coins,
  ArrowDownCircle,
  ArrowUpCircle,
  RotateCcw,
  PiggyBank,
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
  votedCount: number;
  totalEligibleVoters: number;
}

interface OwingMember {
  memberId: number;
  memberName: string;
  memberAvatarKey: string | null;
  memberAvatarUrl: string | null;
  amount: number;
}

interface InventoryBrand {
  brandId: number;
  brandName: string;
  pricePerTube: number;
  currentStockQua: number;
  ong: number;
  qua: number;
  isLowStock: boolean;
}

interface RecentTx {
  id: number;
  type: string;
  direction: "in" | "out" | "neutral";
  amount: number;
  description: string | null;
  createdAt: string;
  memberId: number | null;
  memberName: string | null;
  memberAvatarKey: string | null;
  memberAvatarUrl: string | null;
}

interface DashboardClientProps {
  appName?: string;
  totalOutstanding: number;
  totalPositiveBalance: number;
  owingCount: number;
  topOwingMembers: OwingMember[];
  totalStockQua: number;
  lowStockBrandCount: number;
  inventoryByBrand: InventoryBrand[];
  activeMembersCount: number;
  sessionsThisMonth: number;
  completedSessionsThisMonth: number;
  upcomingSession: UpcomingSession | null;
  monthIn: number;
  monthOut: number;
  monthInventorySpend: number;
  courtRentExpectedThisMonth: number;
  courtRentPaidThisMonth: number;
  courtRentRemainingThisMonth: number;
  recentTransactions: RecentTx[];
  currentMonth: number;
  currentYear: number;
}

const VN_MONTH_LABEL: Record<number, string> = {
  1: "Th1",
  2: "Th2",
  3: "Th3",
  4: "Th4",
  5: "Th5",
  6: "Th6",
  7: "Th7",
  8: "Th8",
  9: "Th9",
  10: "Th10",
  11: "Th11",
  12: "Th12",
};

const TX_ICON: Record<string, { icon: typeof ArrowUpCircle; cls: string }> = {
  fund_contribution: { icon: ArrowUpCircle, cls: "text-green-500" },
  fund_deduction: { icon: ArrowDownCircle, cls: "text-orange-500" },
  fund_refund: { icon: RotateCcw, cls: "text-red-500" },
  inventory_purchase: { icon: ShoppingBag, cls: "text-amber-500" },
  court_rent_payment: { icon: Landmark, cls: "text-cyan-500" },
  bank_payment_received: { icon: ArrowUpCircle, cls: "text-green-500" },
  manual_adjustment: { icon: RotateCcw, cls: "text-muted-foreground" },
  debt_created: { icon: ArrowDownCircle, cls: "text-amber-500" },
  debt_member_confirmed: { icon: ArrowUpCircle, cls: "text-blue-500" },
  debt_admin_confirmed: { icon: ArrowUpCircle, cls: "text-emerald-500" },
  debt_undo: { icon: RotateCcw, cls: "text-muted-foreground" },
};

function shortDateTime(iso: string, locale: string) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(locale === "en" ? "en-US" : locale, {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function DashboardClient({
  appName = "FWBB",
  totalOutstanding,
  totalPositiveBalance,
  owingCount,
  topOwingMembers,
  totalStockQua,
  lowStockBrandCount,
  inventoryByBrand,
  activeMembersCount,
  sessionsThisMonth,
  completedSessionsThisMonth,
  upcomingSession,
  monthIn,
  monthOut,
  monthInventorySpend,
  courtRentExpectedThisMonth,
  courtRentPaidThisMonth,
  courtRentRemainingThisMonth,
  recentTransactions,
  currentMonth,
  currentYear,
}: DashboardClientProps) {
  const tf = useTranslations("finance");
  const td = useTranslations("dashboard");
  const ts = useTranslations("sessions");
  const tInv = useTranslations("inventory");
  const locale = useLocale() as AppLocale;
  const formatDateFull = (d: string) =>
    formatSessionDate(d, "weekdayLong", locale);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(appName);
  const [saved, setSaved] = useState(false);
  usePolling();

  const monthLabel = `${VN_MONTH_LABEL[currentMonth]}/${currentYear}`;
  const netCash = totalPositiveBalance - totalOutstanding;
  const votedPct = upcomingSession
    ? upcomingSession.totalEligibleVoters > 0
      ? Math.min(
          100,
          Math.round(
            (upcomingSession.votedCount / upcomingSession.totalEligibleVoters) *
              100,
          ),
        )
      : 0
    : 0;
  const courtRentPct =
    courtRentExpectedThisMonth > 0
      ? Math.min(
          100,
          Math.round(
            (courtRentPaidThisMonth / courtRentExpectedThisMonth) * 100,
          ),
        )
      : 0;

  return (
    <div className="space-y-6">
      {/* App Name Editor */}
      <div className="flex items-center gap-3">
        {editingName ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = nameValue.trim();
              if (!trimmed) return;
              setEditingName(false);
              setSaved(true);
              setTimeout(() => setSaved(false), 2000);
              fireAction(
                () => updateAppName(trimmed),
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
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setNameValue(appName);
                  setEditingName(false);
                }
              }}
              className="w-48"
              autoFocus
            />
            <Button type="submit" size="sm" variant="outline" aria-label="Lưu">
              <Check className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setNameValue(appName);
                setEditingName(false);
              }}
              aria-label="Hủy"
            >
              <X className="h-4 w-4" />
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
          href="/admin/fund"
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
              {totalStockQua} {tInv("piece")}
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
                  {td("lowStockBanner", { count: totalStockQua })}
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

      {/* Upcoming Session — wrap in LED border when in voting state.
       * Card MUST keep an opaque bg (bg-card) so the rotating conic-gradient
       * sweep of .led-border doesn't leak through. Translucent tints
       * (bg-violet-50/40) cause the bright wedge to bleed across the card. */}
      <div className={cn(upcomingSession?.status === "voting" && "led-border")}>
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
                        <Navigation className="h-4 w-4" /> {ts("directions")}
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

                {/* Vote progress */}
                {upcomingSession.totalEligibleVoters > 0 && (
                  <div className="bg-background/60 dark:bg-background/40 rounded-xl p-3">
                    <div className="mb-1.5 flex items-baseline justify-between text-sm">
                      <span className="text-muted-foreground">
                        Tiến độ vote
                      </span>
                      <span className="text-foreground font-semibold tabular-nums">
                        <span className="text-primary text-lg font-bold">
                          {upcomingSession.votedCount}
                        </span>
                        <span className="text-muted-foreground">
                          /{upcomingSession.totalEligibleVoters}
                        </span>
                      </span>
                    </div>
                    <div className="bg-muted h-2 overflow-hidden rounded-full">
                      <div
                        className="bg-primary h-full rounded-full transition-all"
                        style={{ width: `${votedPct}%` }}
                      />
                    </div>
                  </div>
                )}

                <Link href={`/admin/sessions/${upcomingSession.id}`}>
                  <Button size="lg" className="w-full">
                    {td("manageSession")}
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </Button>
                </Link>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                {td("noUpcoming")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tình hình tài chính — emerald tint */}
      <Card className="border-emerald-200/50 bg-emerald-50/40 dark:border-emerald-900/40 dark:bg-emerald-950/20">
        <CardHeader className="flex-row items-center justify-between gap-3 pb-3">
          <CardTitle className="flex items-center gap-2">
            <PiggyBank className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            Tình hình tài chính
          </CardTitle>
          <Link href="/admin/fund">
            <Button variant="outline" size="sm">
              Chi tiết
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent className="pb-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="bg-background/60 dark:bg-background/40 rounded-xl p-3">
              <div className="text-muted-foreground flex items-center gap-1.5 text-sm">
                <Coins className="h-4 w-4 text-emerald-500" />
                Quỹ còn dư
              </div>
              <div className="mt-1 text-xl font-bold text-emerald-600 tabular-nums dark:text-emerald-400">
                {formatK(totalPositiveBalance)}
              </div>
            </div>
            <div className="bg-background/60 dark:bg-background/40 rounded-xl p-3">
              <div className="text-muted-foreground flex items-center gap-1.5 text-sm">
                <AlertTriangle className="text-destructive h-4 w-4" />
                Tổng nợ
              </div>
              <div className="text-destructive mt-1 text-xl font-bold tabular-nums">
                −{formatK(totalOutstanding)}
              </div>
              <div className="text-muted-foreground mt-0.5 text-xs">
                {owingCount} người
              </div>
            </div>
            <div className="bg-background/60 dark:bg-background/40 col-span-2 rounded-xl p-3 sm:col-span-1">
              <div className="text-muted-foreground flex items-center gap-1.5 text-sm">
                <Wallet className="text-foreground h-4 w-4" />
                Số dư ròng
              </div>
              <div
                className={cn(
                  "mt-1 text-xl font-bold tabular-nums",
                  netCash >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-destructive",
                )}
              >
                {netCash >= 0 ? "+" : ""}
                {formatK(netCash)}
              </div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-emerald-200/40 bg-emerald-100/40 p-3 dark:border-emerald-900/30 dark:bg-emerald-950/30">
              <div className="text-muted-foreground flex items-center gap-1.5 text-sm">
                <TrendingUp className="h-4 w-4 text-emerald-500" />
                Thu {monthLabel}
              </div>
              <div className="mt-1 text-lg font-bold text-emerald-600 tabular-nums dark:text-emerald-400">
                +{formatK(monthIn)}
              </div>
            </div>
            <div className="rounded-xl border border-orange-200/40 bg-orange-100/40 p-3 dark:border-orange-900/30 dark:bg-orange-950/30">
              <div className="text-muted-foreground flex items-center gap-1.5 text-sm">
                <TrendingDown className="h-4 w-4 text-orange-500" />
                Chi {monthLabel}
              </div>
              <div className="mt-1 text-lg font-bold text-orange-600 tabular-nums dark:text-orange-400">
                −{formatK(monthOut)}
              </div>
            </div>
            <div className="bg-background/60 dark:bg-background/40 col-span-2 rounded-xl border p-3 sm:col-span-1">
              <div className="text-muted-foreground flex items-center gap-1.5 text-sm">
                <ShoppingBag className="h-4 w-4 text-amber-500" />
                Mua cầu {monthLabel}
              </div>
              <div className="mt-1 text-lg font-bold text-amber-600 tabular-nums dark:text-amber-400">
                {formatK(monthInventorySpend)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tiền sân tháng — cyan tint */}
      <Card className="border-cyan-200/50 bg-cyan-50/40 dark:border-cyan-900/40 dark:bg-cyan-950/20">
        <CardHeader className="flex-row items-center justify-between gap-3 pb-3">
          <CardTitle className="flex items-center gap-2">
            <Landmark className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
            Tiền sân {monthLabel}
          </CardTitle>
          <Link href="/admin/court-rent">
            <Button variant="outline" size="sm">
              Đối soát
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent className="pb-4">
          {sessionsThisMonth === 0 ? (
            <p className="text-muted-foreground py-2 text-center text-sm">
              Chưa có buổi nào trong tháng
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-background/60 dark:bg-background/40 rounded-xl p-3">
                  <div className="text-muted-foreground text-xs">Cần trả</div>
                  <div className="text-foreground mt-1 text-base font-bold tabular-nums sm:text-lg">
                    {formatK(courtRentExpectedThisMonth)}
                  </div>
                </div>
                <div className="bg-background/60 dark:bg-background/40 rounded-xl p-3">
                  <div className="text-muted-foreground text-xs">Đã trả</div>
                  <div className="mt-1 text-base font-bold text-emerald-600 tabular-nums sm:text-lg dark:text-emerald-400">
                    {formatK(courtRentPaidThisMonth)}
                  </div>
                </div>
                <div className="bg-background/60 dark:bg-background/40 rounded-xl p-3">
                  <div className="text-muted-foreground text-xs">Còn lại</div>
                  <div
                    className={cn(
                      "mt-1 text-base font-bold tabular-nums sm:text-lg",
                      courtRentRemainingThisMonth === 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-orange-600 dark:text-orange-400",
                    )}
                  >
                    {formatK(courtRentRemainingThisMonth)}
                  </div>
                </div>
              </div>

              <div className="bg-muted mt-3 h-2 overflow-hidden rounded-full">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    courtRentPct >= 100 ? "bg-emerald-500" : "bg-cyan-500",
                  )}
                  style={{ width: `${courtRentPct}%` }}
                />
              </div>
              <div className="text-muted-foreground mt-2 text-xs">
                {sessionsThisMonth} buổi trong tháng ·{" "}
                {completedSessionsThisMonth} đã chốt
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Members owing — top 5 — destructive tint. Ẩn nếu không có ai nợ. */}
      {topOwingMembers.length > 0 && (
        <Card className="border-rose-200/50 bg-rose-50/40 dark:border-rose-900/40 dark:bg-rose-950/20">
          <CardHeader className="flex-row items-center justify-between gap-3 pb-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="text-destructive h-5 w-5" />
                Thành viên còn nợ quỹ
              </CardTitle>
              <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-base">
                <span className="text-muted-foreground">
                  <strong className="text-destructive tabular-nums">
                    {owingCount}
                  </strong>{" "}
                  người · tổng
                </span>
                <strong className="text-destructive text-2xl font-bold tabular-nums">
                  {formatK(totalOutstanding)}
                </strong>
              </div>
            </div>
            <Link href="/admin/fund">
              <Button variant="outline" size="sm">
                Xem tất cả
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="pb-4">
            <ul className="bg-background/60 dark:bg-background/40 divide-y rounded-xl">
              {topOwingMembers.map((m) => (
                <li
                  key={m.memberId}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <MemberAvatar
                    memberId={m.memberId}
                    avatarKey={m.memberAvatarKey}
                    avatarUrl={m.memberAvatarUrl}
                    size={32}
                  />
                  <span className="min-w-0 flex-1 truncate text-base font-medium">
                    {m.memberName}
                  </span>
                  <span className="text-destructive shrink-0 text-base font-bold tabular-nums">
                    −{formatK(m.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Recent transactions — slate tint */}
      <Card className="border-slate-200/50 bg-slate-50/40 dark:border-slate-800/40 dark:bg-slate-950/30">
        <CardHeader className="flex-row items-center justify-between gap-3 pb-3">
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-slate-600 dark:text-slate-400" />
            Giao dịch gần đây
          </CardTitle>
          <Link href="/admin/fund/transactions">
            <Button variant="outline" size="sm">
              Xem tất cả
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent className="pb-4">
          {recentTransactions.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-sm">
              Chưa có giao dịch nào
            </p>
          ) : (
            <ul className="bg-background/60 dark:bg-background/40 divide-y rounded-xl">
              {recentTransactions.map((tx) => {
                const meta = TX_ICON[tx.type] ?? {
                  icon: RotateCcw,
                  cls: "text-muted-foreground",
                };
                const Icon = meta.icon;
                const sign =
                  tx.direction === "in"
                    ? "+"
                    : tx.direction === "out"
                      ? "−"
                      : "";
                const amountColor =
                  tx.direction === "in"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : tx.direction === "out"
                      ? "text-red-600 dark:text-red-400"
                      : "text-foreground";
                return (
                  <li
                    key={tx.id}
                    className="flex items-center gap-3 px-3 py-2.5"
                  >
                    {tx.memberId !== null ? (
                      <MemberAvatar
                        memberId={tx.memberId}
                        avatarKey={tx.memberAvatarKey}
                        avatarUrl={tx.memberAvatarUrl}
                        size={32}
                      />
                    ) : (
                      <div className="bg-muted flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
                        <Icon className={cn("h-4 w-4", meta.cls)} />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <Icon
                          className={cn("h-3.5 w-3.5 shrink-0", meta.cls)}
                        />
                        <span className="truncate text-sm font-semibold">
                          {tx.memberName ?? "Hệ thống"}
                        </span>
                      </div>
                      {tx.description && (
                        <p className="text-muted-foreground truncate text-xs">
                          {tx.description}
                        </p>
                      )}
                      <p className="text-muted-foreground text-xs tabular-nums">
                        {shortDateTime(tx.createdAt, locale)}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 text-base font-bold tabular-nums",
                        amountColor,
                      )}
                    >
                      {sign}
                      {formatK(tx.amount)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

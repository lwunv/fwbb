"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { formatSessionDate, ymdInVN } from "@/lib/date-format";
import type { AppLocale } from "@/lib/date-fns-locale";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/shared/stat-card";
import { StatTile } from "@/components/shared/stat-tile";
import { SectionCard } from "@/components/shared/section-card";
import { InlineNotice } from "@/components/shared/inline-notice";
import { EmptyState } from "@/components/shared/empty-state";
import { LedBorder } from "@/components/shared/led-border";
import {
  StatusBadge,
  type StatusVariant,
} from "@/components/shared/status-badge";
import { DefaultSettingsCard } from "./default-settings-card";
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

interface CourtOpt {
  id: number;
  name: string;
  pricePerSession: number;
}
interface BrandOpt {
  id: number;
  name: string;
  pricePerTube: number;
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
  settingsCourts: CourtOpt[];
  settingsBrands: BrandOpt[];
  defaultCourtId: number | null;
  defaultBrandId: number | null;
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
  settingsCourts,
  settingsBrands,
  defaultCourtId,
  defaultBrandId,
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
        <InlineNotice
          tone="danger"
          icon={AlertTriangle}
          action={
            <Link href="/admin/inventory">
              <Button variant="ghost" size="sm">
                {tf("view")}
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          }
        >
          {td("lowStockBanner", { count: totalStockQua })}
        </InlineNotice>
      )}

      {/* Default settings (sân + hãng cầu) — admin chỉ định 1 lần, các buổi
       * tự auto-tạo / admin tạo mới sẽ pre-fill các giá trị này. */}
      <DefaultSettingsCard
        courts={settingsCourts}
        brands={settingsBrands}
        currentCourtId={defaultCourtId}
        currentBrandId={defaultBrandId}
      />

      {/* Upcoming Session — wrap in LED border when buổi sắp/đang diễn ra.
       * Buổi đã qua nhưng chưa finalize (voting/confirmed + date < hôm nay)
       * coi là "Cần xác nhận", không có LED, viền + badge amber. Quy tắc:
       * "chỉ buổi sắp và đang diễn ra mới có LED viền xanh lá".
       *
       * Card MUST keep an opaque bg (bg-card) so the rotating conic-gradient
       * sweep of .led-border doesn't leak through. Translucent tints
       * (bg-violet-50/40) cause the bright wedge to bleed across the card. */}
      {(() => {
        const status = upcomingSession?.status;
        const isUpcomingActive = status === "voting" || status === "confirmed";
        const isPastPending =
          isUpcomingActive &&
          !!upcomingSession &&
          upcomingSession.date < ymdInVN();
        const showLed = isUpcomingActive && !isPastPending;
        const badgeVariant: StatusVariant = isPastPending
          ? "needsConfirm"
          : (status as StatusVariant) || "neutral";
        const badgeText = isPastPending
          ? tf("needsConfirm")
          : ts(status as "voting" | "confirmed" | "completed" | "cancelled");
        return (
          <LedBorder active={showLed} variant="pink">
            <SectionCard
              tone="neutral"
              icon={CalendarDays}
              title={td("upcomingSession")}
              action={
                upcomingSession && (
                  <StatusBadge variant={badgeVariant}>{badgeText}</StatusBadge>
                )
              }
            >
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
                    <div className="bg-background/60 dark:bg-background/40 ring-border/60 rounded-xl p-3 shadow-sm ring-1">
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

                  <Link href="/admin/sessions">
                    <Button size="lg" className="w-full">
                      {td("manageSession")}
                      <ArrowRight className="ml-1 h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              ) : (
                <EmptyState variant="inline" title={td("noUpcoming")} />
              )}
            </SectionCard>
          </LedBorder>
        );
      })()}

      {/* Tình hình tài chính — emerald tint */}
      <SectionCard
        tone="emerald"
        icon={PiggyBank}
        title="Tình hình tài chính"
        action={
          <Link href="/admin/fund">
            <Button variant="outline" size="sm">
              Chi tiết
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </Link>
        }
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatTile
            tone="neutral"
            size="sm"
            icon={Coins}
            label="Quỹ còn dư"
            value={formatK(totalPositiveBalance)}
            valueClassName="text-emerald-600 dark:text-emerald-400 text-xl"
          />
          <StatTile
            tone="neutral"
            size="sm"
            icon={AlertTriangle}
            label="Tổng nợ"
            value={
              <>
                −{formatK(totalOutstanding)}
                <div className="text-muted-foreground mt-0.5 text-xs font-normal">
                  {owingCount} người
                </div>
              </>
            }
            valueClassName="text-destructive text-xl"
          />
          <StatTile
            tone="neutral"
            size="sm"
            icon={Wallet}
            label="Số dư ròng"
            value={`${netCash >= 0 ? "+" : ""}${formatK(netCash)}`}
            valueClassName={cn(
              "text-xl",
              netCash >= 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-destructive",
            )}
            className="col-span-2 sm:col-span-1"
          />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatTile
            tone="emerald"
            size="sm"
            icon={TrendingUp}
            label={`Thu ${monthLabel}`}
            value={`+${formatK(monthIn)}`}
          />
          <StatTile
            tone="orange"
            size="sm"
            icon={TrendingDown}
            label={`Chi ${monthLabel}`}
            value={`−${formatK(monthOut)}`}
          />
          <StatTile
            tone="amber"
            size="sm"
            icon={ShoppingBag}
            label={`Mua cầu ${monthLabel}`}
            value={formatK(monthInventorySpend)}
            className="col-span-2 sm:col-span-1"
          />
        </div>
      </SectionCard>

      {/* Tiền sân tháng — cyan tint */}
      <SectionCard
        tone="cyan"
        icon={Landmark}
        title={`Tiền sân ${monthLabel}`}
        action={
          <Link href="/admin/court-rent">
            <Button variant="outline" size="sm">
              Đối soát
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </Link>
        }
      >
        {sessionsThisMonth === 0 ? (
          <EmptyState variant="inline" title="Chưa có buổi nào trong tháng" />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <StatTile
                tone="neutral"
                size="sm"
                label="Cần trả"
                value={formatK(courtRentExpectedThisMonth)}
              />
              <StatTile
                tone="neutral"
                size="sm"
                label="Đã trả"
                value={formatK(courtRentPaidThisMonth)}
                valueClassName="text-emerald-600 dark:text-emerald-400"
              />
              <StatTile
                tone="neutral"
                size="sm"
                label="Còn lại"
                value={formatK(courtRentRemainingThisMonth)}
                valueClassName={cn(
                  courtRentRemainingThisMonth === 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-orange-600 dark:text-orange-400",
                )}
              />
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
      </SectionCard>

      {/* Members owing — top 5 — rose tint. Ẩn nếu không có ai nợ. */}
      {topOwingMembers.length > 0 && (
        <SectionCard
          tone="rose"
          icon={AlertTriangle}
          title="Thành viên còn nợ quỹ"
          subtitle={
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-base">
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
          }
          action={
            <Link href="/admin/fund">
              <Button variant="outline" size="sm">
                Xem tất cả
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          }
        >
          <ul className="bg-background/60 dark:bg-background/40 ring-border/60 divide-y rounded-xl shadow-sm ring-1">
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
        </SectionCard>
      )}

      {/* Recent transactions — slate tint */}
      <SectionCard
        tone="slate"
        icon={Receipt}
        title="Giao dịch gần đây"
        action={
          <Link href="/admin/fund/transactions">
            <Button variant="outline" size="sm">
              Xem tất cả
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </Link>
        }
      >
        {recentTransactions.length === 0 ? (
          <EmptyState variant="inline" title="Chưa có giao dịch nào" />
        ) : (
          <ul className="bg-background/60 dark:bg-background/40 ring-border/60 divide-y rounded-xl shadow-sm ring-1">
            {recentTransactions.map((tx) => {
              const meta = TX_ICON[tx.type] ?? {
                icon: RotateCcw,
                cls: "text-muted-foreground",
              };
              const Icon = meta.icon;
              const sign =
                tx.direction === "in" ? "+" : tx.direction === "out" ? "−" : "";
              const amountColor =
                tx.direction === "in"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : tx.direction === "out"
                    ? "text-red-600 dark:text-red-400"
                    : "text-foreground";
              return (
                <li key={tx.id} className="flex items-center gap-3 px-3 py-2.5">
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
                      <Icon className={cn("h-3.5 w-3.5 shrink-0", meta.cls)} />
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
      </SectionCard>
    </div>
  );
}

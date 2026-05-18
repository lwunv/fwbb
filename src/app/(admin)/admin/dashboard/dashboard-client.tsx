"use client";

import { useState, useEffect } from "react";
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
import {
  computeShuttlecockTotal,
  computePerHeadCharges,
} from "@/lib/cost-calculator";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { updateAppName } from "@/actions/settings";
import { setAdminGuestCount } from "@/actions/sessions";
import { finalizeSessionAuto } from "@/actions/finance";
import { recordContribution } from "@/actions/fund";
import { fireAction } from "@/lib/optimistic-action";
import { useOptimisticSet } from "@/lib/optimistic-ui";
import { usePolling } from "@/lib/use-polling";
import { CourtSelector } from "@/components/sessions/court-selector";
import { ShuttlecockSelector } from "@/components/sessions/shuttlecock-selector";
import { AdminVoteManager } from "@/components/sessions/admin-vote-manager";
import { WeekStrip } from "@/components/sessions/week-strip";
import { RecordContributionDialog } from "@/components/fund/record-contribution-dialog";
import type { InferSelectModel } from "drizzle-orm";
import type {
  courts as courtsTable,
  shuttlecockBrands as brandsTable,
  sessionShuttlecocks as sessionShuttlecocksTable,
  votes as votesTable,
  members as membersTable,
} from "@/db/schema";
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
  ChevronDown,
  Plus,
} from "lucide-react";

type Vote = InferSelectModel<typeof votesTable> & {
  member: InferSelectModel<typeof membersTable>;
};

interface UpcomingSession {
  id: number;
  date: string;
  status: string;
  courtId: number | null;
  courtName: string | null;
  courtMapLink: string | null;
  courtQuantity: number;
  courtPrice: number | null;
  diningBill: number;
  startTime: string;
  endTime: string;
  playerCount: number;
  dinerCount: number;
  guestPlayCount: number;
  guestDineCount: number;
  adminGuestPlayCount: number;
  adminGuestDineCount: number;
  useMinDeduction: boolean;
  exemptMemberIds: number[];
  votedCount: number;
  totalEligibleVoters: number;
  shuttlecocks: {
    id: number;
    brandId: number;
    brandName: string;
    quantityUsed: number;
    pricePerTube: number;
  }[];
  votes: Vote[];
}

interface OwingMember {
  memberId: number;
  memberName: string;
  memberAvatarKey: string | null;
  memberAvatarUrl: string | null;
  amount: number;
}

interface LowFundMember {
  memberId: number;
  memberName: string;
  memberAvatarKey: string | null;
  memberAvatarUrl: string | null;
  balance: number;
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

type Court = InferSelectModel<typeof courtsTable>;
type Brand = InferSelectModel<typeof brandsTable>;
type SessionShuttlecock = InferSelectModel<typeof sessionShuttlecocksTable> & {
  brand: Brand;
};

interface DashboardClientProps {
  appName?: string;
  totalOutstanding: number;
  totalPositiveBalance: number;
  owingCount: number;
  topOwingMembers: OwingMember[];
  lowFundMembers: LowFundMember[];
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
  editorCourts: Court[];
  editorBrands: Brand[];
  editorMembers: InferSelectModel<typeof membersTable>[];
  defaultCourtId: number | null;
  defaultBrandId: number | null;
  sessionDays: number[];
}

const MONTH_LABEL_BY_LOCALE: Record<string, Record<number, string>> = {
  vi: {
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
  },
  en: {
    1: "Jan",
    2: "Feb",
    3: "Mar",
    4: "Apr",
    5: "May",
    6: "Jun",
    7: "Jul",
    8: "Aug",
    9: "Sep",
    10: "Oct",
    11: "Nov",
    12: "Dec",
  },
  zh: {
    1: "1月",
    2: "2月",
    3: "3月",
    4: "4月",
    5: "5月",
    6: "6月",
    7: "7月",
    8: "8月",
    9: "9月",
    10: "10月",
    11: "11月",
    12: "12月",
  },
};

const TX_ICON: Record<string, { icon: typeof ArrowUpCircle; cls: string }> = {
  fund_contribution: { icon: ArrowUpCircle, cls: "text-blue-500" },
  fund_deduction: { icon: ArrowDownCircle, cls: "text-orange-500" },
  fund_refund: { icon: RotateCcw, cls: "text-red-500" },
  inventory_purchase: { icon: ShoppingBag, cls: "text-amber-500" },
  court_rent_payment: { icon: Landmark, cls: "text-cyan-500" },
  bank_payment_received: { icon: ArrowUpCircle, cls: "text-blue-500" },
  manual_adjustment: { icon: RotateCcw, cls: "text-muted-foreground" },
  debt_created: { icon: ArrowDownCircle, cls: "text-amber-500" },
  debt_member_confirmed: { icon: ArrowUpCircle, cls: "text-blue-500" },
  debt_admin_confirmed: { icon: ArrowUpCircle, cls: "text-blue-500" },
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
  lowFundMembers,
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
  editorCourts,
  editorBrands,
  editorMembers,
  defaultCourtId,
  defaultBrandId,
  sessionDays,
}: DashboardClientProps) {
  const tf = useTranslations("finance");
  const td = useTranslations("dashboard");
  const ts = useTranslations("sessions");
  const tInv = useTranslations("inventory");
  const tFs = useTranslations("fundStatus");
  const locale = useLocale() as AppLocale;
  const formatDateFull = (d: string) =>
    formatSessionDate(d, "weekdayLong", locale);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(appName);
  const [saved, setSaved] = useState(false);
  // Optimistic finalize cho upcoming session — sync với /admin/sessions pattern.
  const finalizing = useOptimisticSet<number>();
  // Optimistic clear-debt: ẩn row debtor ngay khi click "Đã trả nợ", revert
  // nếu server fail. Dùng Set để track multiple members concurrent.
  const clearingDebt = useOptimisticSet<number>();

  function handleClearDebt(memberId: number, amount: number) {
    if (amount <= 0) return;
    const idemKey = `dash-clear-${memberId}-${crypto.randomUUID()}`;
    clearingDebt.addOptimistically(
      memberId,
      () => recordContribution(memberId, amount, td("clearDebtNote"), idemKey),
      { successMsg: td("toastClearDebt", { amount: formatK(amount) }) },
    );
  }

  // "Nộp quỹ" popup state — dialog với member pre-selected & locked. Dùng
  // chung `RecordContributionDialog` với /admin/fund (page kia mở dialog với
  // selectableMembers list, ở đây mở với lockedMember).
  const [contribFor, setContribFor] = useState<OwingMember | null>(null);
  const [contribSubmitting, setContribSubmitting] = useState(false);

  function closeContrib() {
    setContribFor(null);
    setContribSubmitting(false);
  }

  function handleContribSubmit(
    memberId: number,
    amount: number,
    desc: string | undefined,
  ) {
    const idemKey = `dash-contrib-${memberId}-${crypto.randomUUID()}`;
    setContribSubmitting(true);
    fireAction(
      () => recordContribution(memberId, amount, desc, idemKey),
      () => setContribSubmitting(false),
      {
        successMsg: td("toastContrib", { amount: formatK(amount) }),
        onSuccess: closeContrib,
      },
    );
  }
  // Local admin-guest state — optimistic stepper cho dashboard.
  const [localAdminGuests, setLocalAdminGuests] = useState<{
    play: number;
    dine: number;
  } | null>(null);
  // Expand/collapse cho khu danh sách thành viên (chứa Khách stepper + search +
  // AdminVoteManager). Mặc định collapsed để dashboard không quá dài.
  const [membersExpanded, setMembersExpanded] = useState(false);
  usePolling();

  // Auto-prune finalizing set khi server đã chuyển status sang "completed".
  // Reset local admin-guest state khi server converge để tránh stomp giá trị thật.
  const upcomingSessionId = upcomingSession?.id;
  const upcomingSessionStatus = upcomingSession?.status;
  const serverAdminGuestPlay = upcomingSession?.adminGuestPlayCount ?? 0;
  const serverAdminGuestDine = upcomingSession?.adminGuestDineCount ?? 0;
  useEffect(() => {
    if (
      upcomingSessionId &&
      (upcomingSessionStatus === "completed" ||
        upcomingSessionStatus === "cancelled")
    ) {
      finalizing.setSet((prev) => {
        if (!prev.has(upcomingSessionId)) return prev;
        const next = new Set(prev);
        next.delete(upcomingSessionId);
        return next;
      });
    }
    // Drop local override khi nó khớp server (avoid stale local state).
    setLocalAdminGuests((prev) => {
      if (!prev) return prev;
      if (
        prev.play === serverAdminGuestPlay &&
        prev.dine === serverAdminGuestDine
      ) {
        return null;
      }
      return prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- finalizing.setSet is stable
  }, [
    upcomingSessionId,
    upcomingSessionStatus,
    serverAdminGuestPlay,
    serverAdminGuestDine,
  ]);

  const monthLabelMap =
    MONTH_LABEL_BY_LOCALE[locale] ?? MONTH_LABEL_BY_LOCALE.vi;
  const monthLabel = `${monthLabelMap[currentMonth]}/${currentYear}`;
  const netCash = totalPositiveBalance - totalOutstanding;
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
            <Button
              type="submit"
              size="sm"
              variant="outline"
              aria-label={td("ariaSaveAppName")}
            >
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
              aria-label={td("ariaCancelAppName")}
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
          <span className="text-xs text-blue-600">{td("appNameSaved")}</span>
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
                : "bg-blue-500/10 text-blue-500"
          }
          label={tf("shuttleStock")}
          value={
            <span
              className={
                totalStockQua < 12
                  ? "text-red-600"
                  : totalStockQua <= 40
                    ? "text-amber-600"
                    : "text-blue-600"
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
        currentSessionDays={sessionDays}
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
        const todayYmd = ymdInVN();
        const isOptimisticFinalizing =
          !!upcomingSession && finalizing.set.has(upcomingSession.id);
        // Optimistic override: vừa bấm "Xác nhận" → coi như completed cho tới
        // khi server revalidate trả về status thật.
        const status = isOptimisticFinalizing
          ? "completed"
          : upcomingSession?.status;
        const isUpcomingActive = status === "voting" || status === "confirmed";
        const isPastPending =
          isUpcomingActive &&
          !!upcomingSession &&
          upcomingSession.date < todayYmd;
        // Cho phép finalize từ HÔM NAY trở đi (đồng bộ với /admin/sessions).
        const canFinalize =
          isUpcomingActive &&
          !!upcomingSession &&
          upcomingSession.date <= todayYmd;
        const showLed = isUpcomingActive && !isPastPending;
        const badgeVariant: StatusVariant = isPastPending
          ? "needsConfirm"
          : (status as StatusVariant) || "neutral";
        const badgeText = isPastPending
          ? tf("needsConfirm")
          : ts(
              (status ?? "voting") as
                | "voting"
                | "confirmed"
                | "completed"
                | "cancelled",
            );
        const adminGuestPlay =
          localAdminGuests?.play ?? upcomingSession?.adminGuestPlayCount ?? 0;
        const adminGuestDine =
          localAdminGuests?.dine ?? upcomingSession?.adminGuestDineCount ?? 0;
        const handleAdminGuestSet = (play: number, dine: number) => {
          if (!upcomingSession) return;
          const sessionId = upcomingSession.id;
          const prev = {
            play: adminGuestPlay,
            dine: adminGuestDine,
          };
          const next = { play, dine };
          setLocalAdminGuests(next);
          fireAction(
            () => setAdminGuestCount(sessionId, next.play, next.dine),
            () => setLocalAdminGuests(prev),
          );
        };
        // Title đổi theo state — "sắp tới" cho buổi đang vote/confirmed,
        // "cần xác nhận" cho buổi past pending (đã qua nhưng chưa chốt sổ).
        const sectionTitle = isPastPending
          ? td("sessionNeedsConfirm")
          : td("upcomingSession");
        // Cost summary — tính cùng helper với cost-calculator để đồng bộ với
        // /admin/sessions list/detail. Khách của admin (adminGuestPlay/Dine)
        // được tính vào divisor → người thật bớt phải gánh.
        const courtPriceVal = upcomingSession?.courtPrice ?? 0;
        // Round-UP-tổng (đồng bộ calculateSessionCosts) để preview khớp debt
        // thực; per-brand round rồi sum sẽ inflate 1-2k.
        const shuttlecockCost = upcomingSession
          ? computeShuttlecockTotal(upcomingSession.shuttlecocks)
          : 0;
        const diningBillVal = upcomingSession?.diningBill ?? 0;
        const totalExpense = courtPriceVal + shuttlecockCost + diningBillVal;
        const totalPlayers = upcomingSession
          ? upcomingSession.playerCount + upcomingSession.guestPlayCount
          : 0;
        const totalDiners = upcomingSession
          ? upcomingSession.dinerCount + upcomingSession.guestDineCount
          : 0;
        const { playCostPerHead, dineCostPerHead } = computePerHeadCharges({
          courtPrice: courtPriceVal,
          shuttlecockCost,
          diningBill: diningBillVal,
          playerCount: totalPlayers,
          dinerCount: totalDiners,
        });
        const showCostSummary =
          !!upcomingSession &&
          (totalExpense > 0 ||
            playCostPerHead > 0 ||
            dineCostPerHead > 0 ||
            canFinalize);
        return (
          <LedBorder active={showLed} variant="pink">
            <SectionCard
              tone="neutral"
              icon={CalendarDays}
              title={sectionTitle}
              action={
                upcomingSession && (
                  <StatusBadge variant={badgeVariant}>{badgeText}</StatusBadge>
                )
              }
            >
              {upcomingSession ? (
                <div className="space-y-3">
                  <div className="space-y-3">
                    {/* Ngày trên, week strip dưới, strip căn giữa ngang —
                        đồng bộ với /admin/sessions card. */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <CalendarDays className="text-primary h-6 w-6" />
                        <span className="text-2xl font-bold capitalize sm:text-3xl">
                          {formatDateFull(upcomingSession.date)}
                        </span>
                      </div>
                      <WeekStrip sessionDate={upcomingSession.date} />
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
                    {/* Số người chơi/nhậu đã hiển thị trong khu mở rộng danh sách
                        thành viên bên dưới — không lặp ở header. */}
                  </div>

                  {/* Inline editor — sửa sân + cầu (Khách stepper đã chuyển vào
                      khu mở rộng danh sách thành viên bên dưới). */}
                  {isUpcomingActive && (
                    <div className="space-y-2 pt-0">
                      <CourtSelector
                        sessionId={upcomingSession.id}
                        courts={editorCourts}
                        currentCourtId={upcomingSession.courtId}
                        currentCourtQuantity={upcomingSession.courtQuantity}
                        sessionDate={upcomingSession.date}
                        defaultCourtId={defaultCourtId}
                        sessionDays={sessionDays}
                      />
                      <ShuttlecockSelector
                        sessionId={upcomingSession.id}
                        brands={editorBrands}
                        currentShuttlecocks={upcomingSession.shuttlecocks.map(
                          (s) =>
                            ({
                              id: s.id,
                              sessionId: upcomingSession.id,
                              brandId: s.brandId,
                              quantityUsed: s.quantityUsed,
                              pricePerTube: s.pricePerTube,
                              brand:
                                editorBrands.find((b) => b.id === s.brandId) ??
                                ({
                                  id: s.brandId,
                                  name: s.brandName,
                                  pricePerTube: s.pricePerTube,
                                } as Brand),
                            }) as SessionShuttlecock,
                        )}
                      />
                    </div>
                  )}

                  {/* Cost summary — đồng bộ format với /admin/sessions list:
                      label trái + tổng + per-head bên phải, tabular-nums. */}
                  {showCostSummary && (
                    <div className="bg-primary/[0.04] border-primary/20 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border px-3 py-2.5 text-base">
                      <span className="font-semibold">
                        💰 {td("totalExpense")}
                      </span>
                      <span className="ml-auto flex flex-wrap items-baseline justify-end gap-x-1.5">
                        <span className="text-primary text-xl font-bold tabular-nums">
                          {formatK(totalExpense)}
                        </span>
                        {(playCostPerHead > 0 || dineCostPerHead > 0) && (
                          <span className="text-foreground/70 text-base font-semibold tabular-nums">
                            (
                            {playCostPerHead > 0 && (
                              <span className="text-primary">
                                🏸 {formatK(playCostPerHead)}
                              </span>
                            )}
                            {playCostPerHead > 0 && dineCostPerHead > 0 && (
                              <span className="text-foreground/50"> · </span>
                            )}
                            {dineCostPerHead > 0 && (
                              <span className="text-orange-500 dark:text-orange-400">
                                🍻 {formatK(dineCostPerHead)}
                              </span>
                            )}
                            <span className="text-foreground/70 text-sm font-medium">
                              {td("perPerson")})
                            </span>
                          </span>
                        )}
                      </span>
                    </div>
                  )}

                  {/* Members block — toggle counts + expandable AdminVoteManager
                      (chứa Khách stepper + search + member rows). Đồng bộ pattern
                      /admin/sessions list card. */}
                  {isUpcomingActive && (
                    <div
                      className={`border-primary/25 bg-primary/[0.04] overflow-hidden rounded-xl border transition-colors ${
                        membersExpanded
                          ? "border-primary/50"
                          : "hover:border-primary/40"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setMembersExpanded((v) => !v)}
                        className="flex w-full items-center justify-between p-3 text-base"
                      >
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-left">
                          <span className="text-primary">
                            🏸{" "}
                            <strong>
                              {upcomingSession.playerCount +
                                upcomingSession.guestPlayCount}
                            </strong>{" "}
                            <span className="text-foreground/80">
                              {ts("people")}
                            </span>
                            {upcomingSession.guestPlayCount > 0 && (
                              <span className="tabular-nums">
                                {" "}
                                <span className="text-foreground/80">
                                  ({ts("including")}{" "}
                                </span>
                                {upcomingSession.guestPlayCount}{" "}
                                <span className="text-foreground/80">
                                  {ts("guest")})
                                </span>
                              </span>
                            )}
                          </span>
                          <span className="text-orange-500 dark:text-orange-400">
                            🍻{" "}
                            <strong>
                              {upcomingSession.dinerCount +
                                upcomingSession.guestDineCount}
                            </strong>{" "}
                            <span className="text-foreground/80">
                              {ts("people")}
                            </span>
                            {upcomingSession.guestDineCount > 0 && (
                              <span className="tabular-nums">
                                {" "}
                                <span className="text-foreground/80">
                                  ({ts("including")}{" "}
                                </span>
                                {upcomingSession.guestDineCount}{" "}
                                <span className="text-foreground/80">
                                  {ts("guest")})
                                </span>
                              </span>
                            )}
                          </span>
                        </div>
                        <ChevronDown
                          className={`text-muted-foreground h-5 w-5 shrink-0 transition-transform ${membersExpanded ? "rotate-180" : ""}`}
                        />
                      </button>
                      {membersExpanded && (
                        <div className="bg-background/40 border-t p-3">
                          <AdminVoteManager
                            sessionId={upcomingSession.id}
                            votes={upcomingSession.votes}
                            members={editorMembers}
                            readOnly={false}
                            adminGuestPlayCount={adminGuestPlay}
                            adminGuestDineCount={adminGuestDine}
                            onAdminGuestChange={handleAdminGuestSet}
                            minDeductionEnabled={
                              upcomingSession.useMinDeduction
                            }
                            exemptMemberIds={upcomingSession.exemptMemberIds}
                            sessionCosts={{
                              courtPrice: upcomingSession.courtPrice ?? 0,
                              courtName: upcomingSession.courtName,
                              diningBill: upcomingSession.diningBill,
                              shuttlecocks: upcomingSession.shuttlecocks.map(
                                (s) => ({
                                  brandName: s.brandName,
                                  quantity: s.quantityUsed,
                                  pricePerTube: s.pricePerTube,
                                }),
                              ),
                              startTime: upcomingSession.startTime,
                              endTime: upcomingSession.endTime,
                              isCompleted: false,
                            }}
                            hideCostSummary
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Action row: "Xác nhận buổi chơi" (when canFinalize) +
                      link "Quản lý" sang /admin/sessions cho full edit. */}
                  <div className="flex flex-col gap-2 sm:flex-row">
                    {canFinalize && (
                      <Button
                        size="lg"
                        className="flex-1 gap-2"
                        disabled={isOptimisticFinalizing}
                        onClick={() => {
                          finalizing.addOptimistically(
                            upcomingSession.id,
                            () => finalizeSessionAuto(upcomingSession.id),
                            { successMsg: ts("confirmedSuccess") },
                          );
                        }}
                      >
                        <Check className="h-4 w-4" />
                        {isOptimisticFinalizing
                          ? ts("confirming")
                          : ts("confirmSession")}
                      </Button>
                    )}
                    <Link
                      href="/admin/sessions"
                      className={canFinalize ? "sm:flex-1" : "flex-1"}
                    >
                      <Button
                        size="lg"
                        variant={canFinalize ? "outline" : "default"}
                        className="w-full"
                      >
                        {td("manageSession")}
                        <ArrowRight className="ml-1 h-4 w-4" />
                      </Button>
                    </Link>
                  </div>
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
        tone="blue"
        icon={PiggyBank}
        title={td("financeOverviewTitle")}
        action={
          <Link href="/admin/fund">
            <Button variant="outline" size="sm">
              {td("details")}
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
            label={td("fundAvailable")}
            value={formatK(totalPositiveBalance)}
            valueClassName="text-blue-600 dark:text-blue-400 text-xl"
          />
          <StatTile
            tone="neutral"
            size="sm"
            icon={AlertTriangle}
            label={td("totalDebt")}
            value={
              <>
                −{formatK(totalOutstanding)}
                <div className="text-muted-foreground mt-0.5 text-xs font-normal">
                  {td("peopleCount", { count: owingCount })}
                </div>
              </>
            }
            valueClassName="text-destructive text-xl"
          />
          <StatTile
            tone="neutral"
            size="sm"
            icon={Wallet}
            label={td("netCash")}
            value={`${netCash >= 0 ? "+" : ""}${formatK(netCash)}`}
            valueClassName={cn(
              "text-xl",
              netCash >= 0
                ? "text-blue-600 dark:text-blue-400"
                : "text-destructive",
            )}
            className="col-span-2 sm:col-span-1"
          />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatTile
            tone="blue"
            size="sm"
            icon={TrendingUp}
            label={td("monthIn", { label: monthLabel })}
            value={`+${formatK(monthIn)}`}
          />
          <StatTile
            tone="orange"
            size="sm"
            icon={TrendingDown}
            label={td("monthOut", { label: monthLabel })}
            value={`−${formatK(monthOut)}`}
          />
          <StatTile
            tone="amber"
            size="sm"
            icon={ShoppingBag}
            label={td("monthInventorySpend", { label: monthLabel })}
            value={formatK(monthInventorySpend)}
            className="col-span-2 sm:col-span-1"
          />
        </div>
      </SectionCard>

      {/* Tiền sân tháng — cyan tint */}
      <SectionCard
        tone="cyan"
        icon={Landmark}
        title={td("courtRentMonthTitle", { label: monthLabel })}
        action={
          <Link href="/admin/court-rent">
            <Button variant="outline" size="sm">
              {td("reconcile")}
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </Link>
        }
      >
        {sessionsThisMonth === 0 ? (
          <EmptyState variant="inline" title={td("emptySessionsInMonth")} />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <StatTile
                tone="neutral"
                size="sm"
                label={td("courtRentExpected")}
                value={formatK(courtRentExpectedThisMonth)}
              />
              <StatTile
                tone="neutral"
                size="sm"
                label={td("courtRentPaid")}
                value={formatK(courtRentPaidThisMonth)}
                valueClassName="text-blue-600 dark:text-blue-400"
              />
              <StatTile
                tone="neutral"
                size="sm"
                label={
                  courtRentRemainingThisMonth < 0
                    ? td("courtRentOverpaid")
                    : td("courtRentRemaining")
                }
                value={
                  courtRentRemainingThisMonth < 0
                    ? `+${formatK(-courtRentRemainingThisMonth)}`
                    : formatK(courtRentRemainingThisMonth)
                }
                valueClassName={cn(
                  courtRentRemainingThisMonth === 0
                    ? "text-blue-600 dark:text-blue-400"
                    : courtRentRemainingThisMonth < 0
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-orange-600 dark:text-orange-400",
                )}
              />
            </div>

            <div className="bg-muted mt-3 h-2 overflow-hidden rounded-full">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  courtRentPct >= 100 ? "bg-blue-500" : "bg-cyan-500",
                )}
                style={{ width: `${courtRentPct}%` }}
              />
            </div>
            <div className="text-muted-foreground mt-2 text-xs">
              {td("sessionsThisMonthDetail", {
                sessions: sessionsThisMonth,
                completed: completedSessionsThisMonth,
              })}
            </div>
          </>
        )}
      </SectionCard>

      {/* Members owing — top 5 — rose tint. Ẩn nếu không có ai nợ. */}
      {topOwingMembers.length > 0 && (
        <SectionCard
          tone="rose"
          icon={AlertTriangle}
          title={td("owingMembersTitle")}
          subtitle={
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-base">
              <span className="text-muted-foreground">
                <strong className="text-destructive tabular-nums">
                  {owingCount}
                </strong>{" "}
                {td("owingSummary", { count: "" }).trim()}
              </span>
              <strong className="text-destructive text-2xl font-bold tabular-nums">
                {formatK(totalOutstanding)}
              </strong>
            </div>
          }
          action={
            <Link href="/admin/fund">
              <Button variant="outline" size="sm">
                {td("viewAll")}
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          }
        >
          <ul className="bg-background/60 dark:bg-background/40 ring-border/60 divide-y rounded-xl shadow-sm ring-1">
            {topOwingMembers.map((m) => {
              const isClearing = clearingDebt.set.has(m.memberId);
              return (
                <li
                  key={m.memberId}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 transition-opacity",
                    isClearing && "opacity-50",
                  )}
                >
                  <MemberAvatar
                    memberId={m.memberId}
                    avatarKey={m.memberAvatarKey}
                    avatarUrl={m.memberAvatarUrl}
                    size={32}
                  />
                  <div className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className="truncate text-sm font-medium">
                      {m.memberName}
                    </span>
                    <span className="text-destructive shrink-0 text-base font-bold tabular-nums">
                      −{formatK(m.amount)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setContribFor(m)}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded-lg px-3 text-xs font-semibold shadow-sm transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" /> {td("contributeButton")}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleClearDebt(m.memberId, m.amount)}
                    disabled={isClearing}
                    className="border-primary bg-card text-primary hover:bg-primary/10 inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded-lg border-2 px-3 text-xs font-semibold shadow-sm transition-colors disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" /> {td("markPaidButton")}
                  </button>
                </li>
              );
            })}
          </ul>
        </SectionCard>
      )}

      {/* Gần hết quỹ — orange tint. Ẩn nếu không có ai. */}
      {lowFundMembers.length > 0 && (
        <SectionCard
          tone="orange"
          icon={AlertTriangle}
          title={tFs("lowFund")}
          subtitle={
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-base">
              <span className="text-muted-foreground">
                <strong className="text-orange-600 tabular-nums dark:text-orange-400">
                  {lowFundMembers.length}
                </strong>{" "}
                {td("owingSummary", { count: "" }).trim()}
              </span>
            </div>
          }
          action={
            <Link href="/admin/fund">
              <Button variant="outline" size="sm">
                {td("viewAll")}
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          }
        >
          <ul className="bg-background/60 dark:bg-background/40 ring-border/60 divide-y rounded-xl shadow-sm ring-1">
            {lowFundMembers.map((m) => (
              <li
                key={m.memberId}
                className="flex items-center gap-2 px-3 py-2"
              >
                <MemberAvatar
                  memberId={m.memberId}
                  avatarKey={m.memberAvatarKey}
                  avatarUrl={m.memberAvatarUrl}
                  size={32}
                />
                <div className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className="truncate text-sm font-medium">
                    {m.memberName}
                  </span>
                  <span className="shrink-0 text-base font-bold text-orange-600 tabular-nums dark:text-orange-400">
                    {formatK(m.balance)}
                  </span>
                </div>
                <StatusBadge variant="lowFund">{tFs("lowFund")}</StatusBadge>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {/* Recent transactions — slate tint */}
      <SectionCard
        tone="slate"
        icon={Receipt}
        title={td("recentTxTitle")}
        action={
          <Link href="/admin/fund/transactions">
            <Button variant="outline" size="sm">
              {td("viewAll")}
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </Link>
        }
      >
        {recentTransactions.length === 0 ? (
          <EmptyState variant="inline" title={td("emptyTx")} />
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
                  ? "text-blue-600 dark:text-blue-400"
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
                        {tx.memberName ?? td("system")}
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

      {/* "Ghi nhận đóng quỹ" popup — shared component với /admin/fund.
          lockedMember = member dòng đã click → ẩn select. Stepper +/- 100k
          + free typing đều dùng được. */}
      <RecordContributionDialog
        open={contribFor !== null}
        onClose={closeContrib}
        onSubmit={handleContribSubmit}
        lockedMember={
          contribFor
            ? {
                id: contribFor.memberId,
                name: contribFor.memberName,
                avatarKey: contribFor.memberAvatarKey,
                avatarUrl: contribFor.memberAvatarUrl,
                balance: -contribFor.amount,
              }
            : null
        }
        submitting={contribSubmitting}
      />
    </div>
  );
}

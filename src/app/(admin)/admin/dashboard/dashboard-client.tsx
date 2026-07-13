"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { ymdInVN } from "@/lib/date-format";
import type { AppLocale } from "@/lib/date-fns-locale";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/shared/stat-card";
import { StatTile } from "@/components/shared/stat-tile";
import { SectionCard } from "@/components/shared/section-card";
import { InlineNotice } from "@/components/shared/inline-notice";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DefaultSettingsCard } from "./default-settings-card";
import { Input } from "@/components/ui/input";
import { formatK, cn } from "@/lib/utils";
import { getMonthLabels } from "@/lib/i18n-labels";
import { deriveSessionBadge, type SessionStatus } from "@/lib/session-status";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { updateAppName } from "@/actions/settings";
import { setAdminGuestCount, cancelSession } from "@/actions/sessions";
import { finalizeSessionAuto } from "@/actions/finance";
import { recordContribution } from "@/actions/fund";
import { fireAction } from "@/lib/optimistic-action";
import { useOptimisticSet } from "@/lib/optimistic-ui";
import { usePolling } from "@/lib/use-polling";
import {
  AdminSessionCard,
  type AdminSessionCardSession,
} from "@/components/sessions/admin-session-card";
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
  Plus,
} from "lucide-react";

type Vote = InferSelectModel<typeof votesTable> & {
  member: import("@/lib/optimistic-votes").PublicMember;
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
  courtPriceOverridden: boolean;
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
  voteDeadline: string | null;
  maxPlayers: number;
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
  memberBalances: Record<number, number>;
  /** memberId của admin — loại khách admin khỏi forecast floor (khớp finalize). */
  adminMemberId: number | null;
  defaultCourtId: number | null;
  defaultBrandId: number | null;
  sessionDays: number[];
}

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
  memberBalances,
  adminMemberId,
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
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(appName);
  const [saved, setSaved] = useState(false);
  // Optimistic finalize cho upcoming session — sync với /admin/sessions pattern.
  const finalizing = useOptimisticSet<number>();
  // Optimistic clear-debt: ẩn row debtor ngay khi click "Đã trả nợ", revert
  // nếu server fail. Dùng Set để track multiple members concurrent.
  const clearingDebt = useOptimisticSet<number>();

  // Drop the optimistic "clearing" dim once the server returns fresh owing data
  // (the contribution converged). addOptimistically only rolls back on failure;
  // on success it relies on the row leaving the list. That self-heals on a full
  // pay, but a partial pay leaves the member in the list stuck at opacity-50
  // with a disabled button. Keying on an id:amount snapshot lifts the dim when
  // the member's debt drops (or they leave). During render to avoid
  // set-state-in-effect.
  const owingSnapshot = topOwingMembers
    .map((m) => `${m.memberId}:${m.amount}`)
    .join(",");
  const [prevOwingSnapshot, setPrevOwingSnapshot] = useState(owingSnapshot);
  if (owingSnapshot !== prevOwingSnapshot) {
    setPrevOwingSnapshot(owingSnapshot);
    clearingDebt.setSet((prev) => (prev.size ? new Set<number>() : prev));
  }

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
  // Hủy buổi từ dashboard — confirm dialog + optimistic HIDE (buổi đã hủy không
  // còn là "sắp tới" → ẩn card ngay, hiện empty state; rollback nếu server fail).
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [locallyCancelled, setLocallyCancelled] = useState(false);
  // Reset optimistic-cancel khi server đổi sang buổi khác (id đổi hoặc về null).
  // Dùng snapshot-in-render (pattern giống clearingDebt) để tránh set-state-in-effect.
  const [prevUpcomingCancelId, setPrevUpcomingCancelId] = useState(
    upcomingSession?.id ?? null,
  );
  if ((upcomingSession?.id ?? null) !== prevUpcomingCancelId) {
    setPrevUpcomingCancelId(upcomingSession?.id ?? null);
    if (locallyCancelled) setLocallyCancelled(false);
  }

  function handleCancelUpcoming() {
    if (!upcomingSession) return;
    const id = upcomingSession.id;
    setCancelDialogOpen(false);
    setLocallyCancelled(true);
    fireAction(
      () => cancelSession(id),
      () => setLocallyCancelled(false),
    );
  }
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

  const monthLabels = getMonthLabels(locale, "long-vi");
  const monthLabel = `${monthLabels[currentMonth - 1]}/${currentYear}`;
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

        // Không có buổi sắp tới HOẶC vừa optimistic-hủy → empty state. Buổi đã
        // hủy không còn là "sắp tới"; server revalidate sẽ đưa buổi kế/null vào.
        if (!upcomingSession || locallyCancelled) {
          return (
            <SectionCard
              tone="neutral"
              icon={CalendarDays}
              title={td("upcomingSession")}
            >
              <EmptyState variant="inline" title={td("noUpcoming")} />
            </SectionCard>
          );
        }

        // Optimistic finalize override: vừa bấm "Xác nhận" → coi như completed
        // cho tới khi server revalidate. Cùng AdminSessionCard với grid nên
        // transient hiển thị (spinner "Đang chốt sổ...") giống hệt.
        const rawStatus = isOptimisticFinalizing
          ? "completed"
          : upcomingSession.status;
        const effectiveStatus: SessionStatus = (
          ["voting", "confirmed", "completed", "cancelled"].includes(rawStatus)
            ? rawStatus
            : "voting"
        ) as SessionStatus;
        // Badge derivation dùng CHUNG với grid + detail (deriveSessionBadge).
        const badge = deriveSessionBadge(
          effectiveStatus,
          upcomingSession.date,
          todayYmd,
        );
        const isPastPending = badge.isPastPending;
        const isUpcomingActive =
          effectiveStatus === "voting" || effectiveStatus === "confirmed";
        // Cho phép finalize từ HÔM NAY trở đi (đồng bộ với /admin/sessions).
        const canFinalize =
          isUpcomingActive && upcomingSession.date <= todayYmd;
        // Title đổi theo state — "sắp tới" cho buổi đang vote/confirmed, "cần
        // xác nhận" cho buổi past pending (đã qua nhưng chưa chốt sổ).
        const sectionTitle = isPastPending
          ? td("sessionNeedsConfirm")
          : td("upcomingSession");

        // Khách-của-admin HIỆU LỰC (optimistic override + server fallback).
        const adminGuestPlay =
          localAdminGuests?.play ?? upcomingSession.adminGuestPlayCount;
        const adminGuestDine =
          localAdminGuests?.dine ?? upcomingSession.adminGuestDineCount;
        const handleAdminGuestSet = (play: number, dine: number) => {
          const sessionId = upcomingSession.id;
          const prev = { play: adminGuestPlay, dine: adminGuestDine };
          const next = { play, dine };
          setLocalAdminGuests(next);
          fireAction(
            () => setAdminGuestCount(sessionId, next.play, next.dine),
            () => setLocalAdminGuests(prev),
          );
        };

        // Map shuttlecock (shape page.tsx) → SessionShuttlecock để
        // AdminSessionCard render selector + tính cost. Brand lấy từ
        // editorBrands, fallback dựng tối thiểu từ snapshot; `as` cast vì
        // object literal thiếu vài cột schema không dùng tới ở đây.
        const cardShuttlecocks: SessionShuttlecock[] =
          upcomingSession.shuttlecocks.map(
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
          );

        // Dashboard's upcoming = voting/confirmed → chưa có debt/attendee.
        const cardSession: AdminSessionCardSession = {
          id: upcomingSession.id,
          date: upcomingSession.date,
          startTime: upcomingSession.startTime,
          endTime: upcomingSession.endTime,
          status: upcomingSession.status,
          courtId: upcomingSession.courtId,
          courtQuantity: upcomingSession.courtQuantity,
          courtName: upcomingSession.courtName,
          courtMapLink: upcomingSession.courtMapLink,
          courtPrice: upcomingSession.courtPrice,
          courtPriceOverridden: upcomingSession.courtPriceOverridden,
          diningBill: upcomingSession.diningBill,
          adminGuestPlayCount: upcomingSession.adminGuestPlayCount,
          adminGuestDineCount: upcomingSession.adminGuestDineCount,
          useMinDeduction: upcomingSession.useMinDeduction,
          exemptMemberIds: upcomingSession.exemptMemberIds,
          playerCount: upcomingSession.playerCount,
          dinerCount: upcomingSession.dinerCount,
          guestPlayCount: upcomingSession.guestPlayCount,
          guestDineCount: upcomingSession.guestDineCount,
          totalDebt: 0,
          paidDebt: 0,
          unpaidDebts: [],
          votes: upcomingSession.votes,
          shuttlecocks: cardShuttlecocks,
          debtMap: {},
          attendees: [],
          voteDeadline: upcomingSession.voteDeadline,
          maxPlayers: upcomingSession.maxPlayers,
        };
        return (
          <div className="space-y-2">
            {/* Section title giữ nhịp dashboard; thẻ dùng CHUNG AdminSessionCard
                với grid /admin/sessions + trang chi tiết để trông giống hệt.
                LED viền + badge + selector + cost + members đều do card render. */}
            <div className="font-heading text-muted-foreground flex items-center gap-2 text-base font-medium">
              <CalendarDays className="h-5 w-5 shrink-0" />
              <span>{sectionTitle}</span>
            </div>
            <AdminSessionCard
              session={cardSession}
              effectiveStatus={effectiveStatus}
              isPastPending={isPastPending}
              badge={badge}
              courts={editorCourts}
              brands={editorBrands}
              members={editorMembers}
              memberBalances={memberBalances}
              defaultCourtId={defaultCourtId}
              sessionDays={sessionDays}
              adminMemberId={adminMemberId}
              adminGuestPlay={adminGuestPlay}
              adminGuestDine={adminGuestDine}
              onAdminGuestChange={handleAdminGuestSet}
              paidDebtIds={new Set<number>()}
              onCancel={() => setCancelDialogOpen(true)}
              canFinalize={canFinalize}
              isFinalizing={isOptimisticFinalizing}
              onFinalize={() =>
                finalizing.addOptimistically(
                  upcomingSession.id,
                  () => finalizeSessionAuto(upcomingSession.id),
                  { successMsg: ts("confirmedSuccess") },
                )
              }
              membersCollapsible
              expanded={membersExpanded}
              onToggleExpand={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMembersExpanded((v) => !v);
              }}
              onExpandedChange={(next) => setMembersExpanded(next)}
              costExtraAction={
                <Link href="/admin/sessions">
                  <Button
                    size="lg"
                    variant={canFinalize ? "outline" : "default"}
                    className="min-h-11 w-full px-3 whitespace-nowrap"
                  >
                    <span className="sm:hidden">Quản lý</span>
                    <span className="hidden sm:inline">
                      {td("manageSession")}
                    </span>
                    <ArrowRight className="ml-1 h-4 w-4 shrink-0" />
                  </Button>
                </Link>
              }
            />
          </div>
        );
      })()}

      {/* Default settings (sân + hãng cầu) — admin chỉ định 1 lần, các buổi
       * tự auto-tạo / admin tạo mới sẽ pre-fill các giá trị này. Đặt sau
       * UI buổi chơi vì admin ít khi cần đụng — UI buổi chơi mới là focus. */}
      <DefaultSettingsCard
        courts={settingsCourts}
        brands={settingsBrands}
        currentCourtId={defaultCourtId}
        currentBrandId={defaultBrandId}
        currentSessionDays={sessionDays}
      />

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
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {m.memberName}
                  </span>
                  <span className="text-destructive shrink-0 text-base font-bold tabular-nums">
                    −{formatK(m.amount)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setContribFor(m)}
                    aria-label={td("contributeButton")}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-lg px-0 text-sm font-semibold shadow-sm transition-colors sm:min-w-0 sm:px-3"
                  >
                    <Plus className="h-4 w-4" />
                    <span className="hidden sm:inline">
                      {td("contributeButton")}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleClearDebt(m.memberId, m.amount)}
                    disabled={isClearing}
                    aria-label={td("markPaidButton")}
                    className="border-primary bg-card text-primary hover:bg-primary/10 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-lg border-2 px-0 text-sm font-semibold shadow-sm transition-colors disabled:opacity-50 sm:min-w-0 sm:px-3"
                  >
                    <Check className="h-4 w-4" />
                    <span className="hidden sm:inline">
                      {td("markPaidButton")}
                    </span>
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

      {/* Hủy buổi sắp tới — confirm trước (AdminSessionCard hiện nút X hủy cho
          buổi active, giống grid/detail). Hủy đơn giản, không pass-sân. */}
      <ConfirmDialog
        open={cancelDialogOpen}
        onOpenChange={setCancelDialogOpen}
        title={ts("cancelSession")}
        description={ts("cancelConfirm")}
        onConfirm={handleCancelUpcoming}
      />
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { formatK, cn } from "@/lib/utils";
import {
  computeShuttlecockTotal,
  computePerHeadCharges,
  computePredictedPlayRevenue,
  computePredictedMinDeductionSurplus,
} from "@/lib/cost-calculator";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { CourtSelector } from "@/components/sessions/court-selector";
import { ShuttlecockSelector } from "@/components/sessions/shuttlecock-selector";
import { AdminVoteManager } from "@/components/sessions/admin-vote-manager";
import { WeekStrip } from "@/components/sessions/week-strip";
import { SessionCostStats } from "@/components/sessions/session-cost-stats";
import { VoteCountdown } from "@/components/sessions/vote-countdown";
import { VoteDeadlineEdit } from "@/components/sessions/vote-deadline-edit";
import { MaxPlayersToggle } from "@/components/sessions/max-players-toggle";
import { LedBorder } from "@/components/shared/led-border";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  Calendar,
  Clock,
  MapPin,
  ChevronDown,
  Navigation,
  AlertTriangle,
  X,
  Check,
  RotateCcw,
} from "lucide-react";
import { formatSessionDate as fmtSessionDate } from "@/lib/date-format";
import type { SessionBadge, SessionStatus } from "@/lib/session-status";
import type { InferSelectModel } from "drizzle-orm";
import type {
  votes as votesTable,
  members as membersTable,
  courts as courtsTable,
  shuttlecockBrands as brandsTable,
  sessionShuttlecocks as sessionShuttlecocksTable,
} from "@/db/schema";

type Vote = InferSelectModel<typeof votesTable> & {
  member: import("@/lib/optimistic-votes").PublicMember;
};
type Court = InferSelectModel<typeof courtsTable>;
type Brand = InferSelectModel<typeof brandsTable>;
type SessionShuttlecock = InferSelectModel<typeof sessionShuttlecocksTable> & {
  brand: Brand;
};
type Member = InferSelectModel<typeof membersTable>;

export interface AdminSessionCardUnpaidDebt {
  debtId: number;
  memberId: number;
  memberName: string;
  memberAvatarKey: string | null;
  memberAvatarUrl: string | null;
  amount: number;
}

export interface AdminSessionCardAttendee {
  memberId: number | null;
  memberName: string | null;
  memberAvatarKey: string | null;
  memberAvatarUrl: string | null;
  guestName: string | null;
  isGuest: boolean;
  attendsPlay: boolean;
  attendsDine: boolean;
  invitedById: number | null;
  invitedByName: string | null;
}

/**
 * Shape the card needs from a session. `session-list`'s richer `SessionCard`
 * is a structural superset (assignable), and `session-detail` builds this
 * object by deriving the aggregate counts from its `votes` prop.
 *
 * `status` is the RAW server status (used only to gate the deadline row), while
 * the resolved/optimistic status arrives via the separate `effectiveStatus`
 * prop — the caller owns the optimistic overrides (finalize/cancel/unlock).
 */
export interface AdminSessionCardSession {
  id: number;
  date: string;
  startTime: string | null;
  endTime: string | null;
  status: string | null;
  courtId: number | null;
  courtQuantity: number;
  courtName: string | null;
  courtMapLink: string | null;
  courtPrice: number | null;
  courtPriceOverridden: boolean;
  diningBill: number;
  adminGuestPlayCount: number;
  adminGuestDineCount: number;
  useMinDeduction: boolean;
  exemptMemberIds: number[];
  playerCount: number;
  dinerCount: number;
  guestPlayCount: number;
  guestDineCount: number;
  totalDebt: number;
  paidDebt: number;
  unpaidDebts: AdminSessionCardUnpaidDebt[];
  votes: Vote[];
  shuttlecocks: SessionShuttlecock[];
  debtMap: Record<
    number,
    { amount: number; adminConfirmed: boolean; debtId: number }
  >;
  attendees: AdminSessionCardAttendee[];
  voteDeadline: string | null;
  maxPlayers: number;
}

export interface AdminSessionCardProps {
  session: AdminSessionCardSession;

  /** Resolved status — caller folds its optimistic overrides in before passing. */
  effectiveStatus: SessionStatus;
  /** Buổi đã qua ngày nhưng vẫn voting/confirmed (từ `deriveSessionBadge`). */
  isPastPending: boolean;
  badge: SessionBadge;

  // Config / display data
  courts: Court[];
  brands: Brand[];
  members: Member[];
  memberBalances: Record<number, number>;
  defaultCourtId: number | null;
  sessionDays?: readonly number[] | number[];
  /** Admin's memberId — khách có `invitedById` trùng = "Khách Admin". */
  adminMemberId: number | null;

  /** Số khách-của-admin HIỆU LỰC (parent giữ optimistic override; server value
   *  làm fallback). Dùng cho cost + AdminVoteManager stepper. */
  adminGuestPlay: number;
  adminGuestDine: number;
  /** Có mặt → AdminVoteManager render stepper khách-của-admin (grid). Vắng
   *  (detail) → không render stepper (giữ đúng props mỗi trang truyền hôm nay). */
  onAdminGuestChange?: (play: number, dine: number) => void;

  /**
   * Optimistic mirror của giá/tên sân + danh sách cầu (detail). Khi truyền,
   * cost + AdminVoteManager đọc các giá trị này để cập nhật NGAY khi selector
   * đổi; khi vắng (grid), fallback về giá trị server trên `session`. Selector
   * `current*` LUÔN đọc giá trị server thô để giữ resync đúng.
   */
  costCourtPrice?: number;
  costCourtName?: string | null;
  costShuttlecocks?: SessionShuttlecock[];
  onCourtChange?: (price: number, name: string | null) => void;
  onItemsChange?: (items: SessionShuttlecock[]) => void;

  /**
   * Optional secondary action rendered inside `SessionCostStats` (via its
   * `extraAction` slot) — vd nút "Quản lý buổi chơi" của dashboard trỏ sang
   * /admin/sessions. Grid/detail bỏ qua → cost stats chỉ render nút Xác nhận.
   * Additive + backward-compatible: khi vắng, hành vi y hệt trước.
   */
  costExtraAction?: React.ReactNode;

  // Payment (grid footer)
  paidDebtIds: Set<number>;
  /** "Đã nhận" trên unpaid debt row (grid). Caller giữ optimistic + idempotencyKey. */
  onConfirmPayment?: (debtId: number, memberName: string) => void;

  // Actions
  onCancel: () => void;
  canFinalize?: boolean;
  isFinalizing?: boolean;
  onFinalize?: () => void;
  /** Mở lại buổi đã completed (grid). */
  onReopenCompleted?: () => void;
  /** Mở lại buổi đã cancelled (grid). */
  onReopenCancelled?: () => void;

  /**
   * `true` (mặc định, grid): danh sách thành viên gói trong toggle collapse +
   * hiện các block completed/cancelled/attendee. `false` (detail): AdminVoteManager
   * LUÔN mở, ẩn các block footer grid-only.
   */
  membersCollapsible?: boolean;
  expanded?: boolean;
  /** Toggle members collapse (grid header) — caller preventDefault/stopPropagation. */
  onToggleExpand?: (e: React.MouseEvent) => void;
  /** Set expanded trực tiếp (grid completed footer buttons). */
  onExpandedChange?: (next: boolean) => void;
}

const statusStyles: Record<
  SessionStatus,
  { labelKey: SessionStatus; cardBg: string }
> = {
  // Voting / confirmed: viền pink LED neon (LedBorder bao ngoài Card),
  // không cần thêm bg ở Card → giữ bg-card consistent across themes.
  voting: { labelKey: "voting", cardBg: "" },
  confirmed: { labelKey: "confirmed", cardBg: "" },
  completed: {
    labelKey: "completed",
    // Buổi đã hoàn thành: viền xanh lơ (cyan) rõ ràng để phân biệt nhanh với
    // buổi đang vote / cần chốt sổ.
    cardBg:
      "border-cyan-400 border-2 ring-2 ring-cyan-200/50 dark:border-cyan-500 dark:ring-cyan-900/30",
  },
  cancelled: {
    labelKey: "cancelled",
    // Buổi hủy: border ĐỎ rõ ràng + nền xám desaturated (opacity giảm cảm giác
    // "không còn relevant").
    cardBg:
      "border-red-400 border-2 ring-2 ring-red-200/50 bg-zinc-100 opacity-85 dark:border-red-500 dark:bg-zinc-800/40 dark:ring-red-900/30",
  },
};

/**
 * Thẻ quản trị buổi chơi dùng CHUNG cho grid (`/admin/sessions`) và trang chi
 * tiết (`/admin/sessions/[id]`), để 2 nơi trông giống hệt và chia sẻ code.
 *
 * Grid: `membersCollapsible` (mặc định) → danh sách thành viên trong toggle,
 * kèm block completed/cancelled/attendee + nút chốt sổ. Detail: `membersCollapsible=false`
 * → AdminVoteManager luôn mở dưới SessionCostStats (giống layout grid), ẩn footer.
 *
 * Card CHỈ trình bày + tính toán chi phí (qua các helper chung của
 * cost-calculator). Mọi optimistic/action semantics do caller giữ và truyền
 * xuống qua callback.
 */
export function AdminSessionCard({
  session,
  effectiveStatus,
  isPastPending,
  badge,
  courts,
  brands,
  members,
  memberBalances,
  defaultCourtId,
  sessionDays,
  adminMemberId,
  adminGuestPlay,
  adminGuestDine,
  onAdminGuestChange,
  costCourtPrice,
  costCourtName,
  costShuttlecocks,
  onCourtChange,
  onItemsChange,
  costExtraAction,
  paidDebtIds,
  onConfirmPayment,
  onCancel,
  canFinalize = false,
  isFinalizing = false,
  onFinalize,
  onReopenCompleted,
  onReopenCancelled,
  membersCollapsible = true,
  expanded = false,
  onToggleExpand,
  onExpandedChange,
}: AdminSessionCardProps) {
  const t = useTranslations("sessions");
  const tF = useTranslations("finance");
  const tVoting = useTranslations("voting");

  const status = statusStyles[effectiveStatus];

  // "Đã đóng vote": deadline đã qua nhưng buổi VẪN ở status voting (admin chưa
  // confirm/finalize). Tính client-side (giống VoteCountdown) để tránh hydration
  // mismatch: pre-hydration coi như còn mở (LED sáng), sau mount mới flip. Dùng
  // cùng `new Date()` với VoteCountdown → khớp đúng lúc nó hiện "Đã đóng vote".
  const [voteClosed, setVoteClosed] = useState(false);
  useEffect(() => {
    const dl = session.voteDeadline;
    // Gộp điều kiện + reset vào 1 hàm rồi gọi gián tiếp (giống VoteCountdown) để
    // tránh setState trực tiếp trong thân effect (react-hooks/set-state-in-effect).
    const sync = () =>
      setVoteClosed(
        !!dl &&
          effectiveStatus === "voting" &&
          new Date(dl).getTime() - Date.now() <= 0,
      );
    sync();
    if (!dl || effectiveStatus !== "voting") return;
    const id = setInterval(sync, 1000);
    return () => clearInterval(id);
  }, [session.voteDeadline, effectiveStatus]);

  // Filter unpaid debts đã optimistically paid → list rút ngắn ngay
  // khi admin bấm "Đã nhận", không chờ revalidate.
  const optimisticUnpaidDebts = session.unpaidDebts.filter(
    (d) => !paidDebtIds.has(d.debtId),
  );
  const optimisticPaidExtra = session.unpaidDebts
    .filter((d) => paidDebtIds.has(d.debtId))
    .reduce((sum, d) => sum + d.amount, 0);
  const unpaidAmount =
    session.totalDebt - session.paidDebt - optimisticPaidExtra;
  const allPaid = effectiveStatus === "completed" && unpaidAmount <= 0;
  const isExpanded = expanded;
  const isActive =
    effectiveStatus === "voting" || effectiveStatus === "confirmed";
  // Vote đã đóng (voting + hết hạn, chưa quá ngày): buổi CHỜ ADMIN CHỐT SỔ →
  // coi như "cần xác nhận" như buổi quá ngày. Badge amber "Đã đóng vote", KHÔNG
  // LED. Khớp đúng thời điểm VoteCountdown báo đóng.
  const voteClosedPending =
    voteClosed && effectiveStatus === "voting" && !isPastPending;
  // Cần xác nhận (quá hạn ngày HOẶC vote đã đóng, chưa chốt sổ): border VÀNG.
  const cardBgClass =
    isPastPending || voteClosedPending
      ? "bg-card border-amber-400 border-2 ring-2 ring-amber-200/50 dark:border-amber-500 dark:ring-amber-900/30"
      : status.cardBg;
  // vote đã đóng → badge amber "needsConfirm" (đồng bộ border vàng) nhưng giữ
  // chữ "Đã đóng vote"; past-pending giữ badge.variant (đã là needsConfirm).
  const badgeVariant = voteClosedPending ? "needsConfirm" : badge.variant;
  const badgeText = isPastPending
    ? tF("needsConfirm")
    : voteClosedPending
      ? tVoting("voteClosedLabel")
      : t(status.labelKey);
  const ag = { play: adminGuestPlay, dine: adminGuestDine };
  const totalGuestPlay =
    session.guestPlayCount + ag.play - session.adminGuestPlayCount;
  const totalGuestDine =
    session.guestDineCount + ag.dine - session.adminGuestDineCount;

  // Giá/tên sân + cầu HIỆU LỰC cho tính toán chi phí. Grid không truyền override
  // → dùng giá trị server trên session (giữ hành vi cũ byte-for-byte). Detail
  // truyền local mirror → cost cập nhật optimistic khi selector đổi.
  const effCourtPrice = costCourtPrice ?? session.courtPrice ?? 0;
  const effCourtName =
    costCourtName !== undefined ? costCourtName : session.courtName;
  const effShuttlecocks = costShuttlecocks ?? session.shuttlecocks;

  // Per-head & total — dùng cùng helper với cost-calculator để đồng bộ
  // 3 trang admin (list / detail / dashboard).
  const courtPriceVal = effCourtPrice;
  // Round-UP-tổng (đồng bộ calculateSessionCosts). Per-brand round
  // rồi sum sẽ inflate 1-2k → preview lệch debt thực.
  const shuttlecockCost = computeShuttlecockTotal(effShuttlecocks);
  const totalPlayers = session.playerCount + totalGuestPlay;
  const totalDiners = session.dinerCount + totalGuestDine;
  const { playCostPerHead, adminGuestPlayCostPerHead, dineCostPerHead } =
    computePerHeadCharges({
      courtPrice: courtPriceVal,
      shuttlecockCost,
      diningBill: session.diningBill,
      playerCount: totalPlayers,
      dinerCount: totalDiners,
      // Khách-của-admin trả sàn 60K → preview khớp finalize.
      adminGuestPlayHeads: ag.play,
    });
  const totalExpense = courtPriceVal + shuttlecockCost + session.diningBill;

  const showLed = isActive && !isPastPending && !voteClosed;

  // AdminVoteManager readOnly khi buổi đã chốt/hủy. Ở grid, block members chỉ
  // render khi isActive nên readOnly luôn = false (giữ nguyên props cũ); ở detail
  // (luôn mở) thì completed/cancelled → readOnly.
  const voteReadOnly = !isActive;

  // Cùng một AdminVoteManager cho cả 2 mode (giữ props y hệt mỗi trang hôm nay).
  const voteManagerNode = (
    <AdminVoteManager
      sessionId={session.id}
      votes={session.votes}
      members={members}
      debtMap={session.debtMap}
      readOnly={voteReadOnly}
      adminGuestPlayCount={ag.play}
      adminGuestDineCount={ag.dine}
      onAdminGuestChange={onAdminGuestChange}
      minDeductionEnabled={session.useMinDeduction}
      exemptMemberIds={session.exemptMemberIds}
      memberBalances={memberBalances}
      sessionCosts={{
        courtPrice: effCourtPrice,
        courtName: effCourtName,
        diningBill: session.diningBill,
        shuttlecocks: effShuttlecocks.map((s) => ({
          brandName: s.brand?.name ?? "",
          quantity: s.quantityUsed,
          pricePerTube: s.pricePerTube,
        })),
        startTime: session.startTime ?? "20:30",
        endTime: session.endTime ?? "22:30",
        isCompleted: effectiveStatus === "completed",
      }}
      hideCostSummary
    />
  );

  return (
    <LedBorder active={showLed} variant="pink">
      <Card className={cn("relative", cardBgClass)}>
        <CardContent className="space-y-2 p-4 sm:space-y-4">
          {/* Header: Date + Status */}
          {/* Hàng 1: ngày + giờ (trái) · trạng thái + huỷ (phải). */}
          {/* Trạng thái + huỷ: ABSOLUTE góc phải trên → không
              chiếm 1 hàng riêng (tiết kiệm height). Header chừa
              pr-28 để ngày/giờ không chạy dưới badge. */}
          <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
            <StatusBadge variant={badgeVariant}>{badgeText}</StatusBadge>
            {isActive && (
              <Button
                variant="destructive"
                size="icon-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onCancel();
                }}
                aria-label={t("ariaCancelSession")}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 pr-28">
            <p className="flex items-center gap-2 text-base font-bold capitalize">
              <Calendar className="text-muted-foreground h-5 w-5 shrink-0" />
              {fmtSessionDate(session.date, "weekdayLong")}
            </p>
            {(session.startTime || session.endTime) && (
              <span className="text-muted-foreground inline-flex items-center gap-1.5 text-sm whitespace-nowrap tabular-nums">
                <Clock className="h-4 w-4" />
                {session.startTime ?? "—"} – {session.endTime ?? "—"}
              </span>
            )}
          </div>

          {/* Dãy thứ — FULL WIDTH (7 ô chia đều 1 hàng). */}
          <WeekStrip sessionDate={session.date} className="w-full" />

          {/* Địa điểm — full width, "Chỉ đường" sát lề phải. */}
          {session.courtName && (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <MapPin className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {session.courtName}
              </span>
              {session.courtMapLink && (
                <span
                  role="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.open(session.courtMapLink!, "_blank");
                  }}
                  className="text-primary ml-auto inline-flex shrink-0 items-center gap-1"
                >
                  <Navigation className="h-4 w-4" />
                  {t("directions")}
                </span>
              )}
            </p>
          )}

          {/* Court + Shuttlecock selectors — luôn hiện cho buổi active
              VÀ past pending. Past pending cần edit court/shuttle để
              finalize đúng (admin có thể chốt lại số quả thực dùng,
              thay sân nếu hôm đó đổi sân, v.v.). */}
          {isActive && (
            <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
              <CourtSelector
                sessionId={session.id}
                courts={courts}
                currentCourtId={session.courtId}
                currentCourtQuantity={session.courtQuantity}
                currentCourtPrice={session.courtPrice}
                isCourtPriceOverridden={session.courtPriceOverridden}
                sessionDate={session.date}
                defaultCourtId={defaultCourtId}
                sessionDays={sessionDays}
                onCourtChange={onCourtChange}
              />
              <ShuttlecockSelector
                sessionId={session.id}
                brands={brands}
                currentShuttlecocks={session.shuttlecocks}
                onItemsChange={onItemsChange}
              />
              {(session.status === "voting" ||
                session.status === "confirmed") && (
                <div className="flex flex-nowrap items-center gap-1.5 pt-1">
                  <span className="min-w-0 flex-1 truncate">
                    <VoteCountdown
                      deadline={session.voteDeadline}
                      variant="inline"
                    />
                  </span>
                  <VoteDeadlineEdit
                    sessionId={session.id}
                    current={session.voteDeadline}
                  />
                  <MaxPlayersToggle
                    sessionId={session.id}
                    current={session.maxPlayers}
                  />
                </div>
              )}
            </div>
          )}

          {/* Tóm tắt Chi vs Thu vs Lãi/Lỗ — 3-column stat tile
              để admin dễ so sánh. Logic Thu:
              - completed: session.totalDebt (actual)
              - past-pending: predicted Thu = totalPlayers × playPerHead
                + totalDiners × dinePerHead
              - voting/confirmed future: skip Thu, chỉ show Chi
              Lãi = Thu − Chi. Âm = lỗ (đỏ). */}
          {effectiveStatus !== "cancelled" &&
            (totalExpense > 0 ||
              playCostPerHead > 0 ||
              dineCostPerHead > 0 ||
              canFinalize) &&
            (() => {
              const showRevenue =
                effectiveStatus === "completed" || isPastPending;
              // Predicted revenue MUST include min-60K penalty
              // surplus (members below playPerHead get floored to
              // 60K, admin captures the difference). Plain
              // `players × playPerHead` understates "Tổng thu".
              const predictedPenaltySurplus = session.useMinDeduction
                ? computePredictedMinDeductionSurplus({
                    playingMemberIds: session.votes
                      .filter((v) => v.willPlay)
                      .map((v) => v.member.id),
                    memberBalances,
                    exemptMemberIds: session.exemptMemberIds,
                    playCostPerHead,
                  })
                : 0;
              // Nhóm chia đều trả splitRate; khách-của-admin trả sàn
              // 60K riêng (qua helper chung để không drift).
              const predictedRevenue =
                computePredictedPlayRevenue({
                  totalPlayHeads: totalPlayers,
                  adminGuestPlayHeads: ag.play,
                  playCostPerHead,
                  adminGuestPlayCostPerHead,
                }) +
                totalDiners * dineCostPerHead +
                predictedPenaltySurplus;
              const revenue =
                effectiveStatus === "completed"
                  ? session.totalDebt
                  : predictedRevenue;
              return (
                <div className="pt-1">
                  <SessionCostStats
                    totalExpense={totalExpense}
                    playCostPerHead={playCostPerHead}
                    dineCostPerHead={dineCostPerHead}
                    revenue={showRevenue ? revenue : null}
                    revenueLabel={
                      effectiveStatus === "completed" ? "actual" : "predicted"
                    }
                    canFinalize={canFinalize}
                    isFinalizing={isFinalizing}
                    onFinalize={onFinalize}
                    confirmLabel={t("confirmSession")}
                    confirmingLabel={t("confirming")}
                    extraAction={costExtraAction}
                  />
                </div>
              );
            })()}

          {/* Members block — grid: toggle + danh sách trong CÙNG 1 card chung.
              Detail (membersCollapsible=false): AdminVoteManager luôn mở. */}
          {membersCollapsible
            ? isActive && (
                <div
                  className={`border-primary/25 bg-primary/[0.04] overflow-hidden rounded-xl border transition-colors ${
                    isExpanded ? "border-primary/50" : "hover:border-primary/40"
                  }`}
                >
                  <button
                    type="button"
                    onClick={onToggleExpand}
                    className="flex w-full items-center justify-between p-3 text-base"
                  >
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-left">
                      <span className="text-primary">
                        🏸 {tVoting("badmintonShort")}:{" "}
                        <strong>{session.playerCount + totalGuestPlay}</strong>{" "}
                        <span className="text-foreground/80">
                          {t("people")}
                        </span>
                        {totalGuestPlay > 0 && (
                          <span className="tabular-nums">
                            {" "}
                            <span className="text-foreground/80">
                              ({t("including")}{" "}
                            </span>
                            {totalGuestPlay}{" "}
                            <span className="text-foreground/80">
                              {t("guest")})
                            </span>
                          </span>
                        )}
                      </span>
                      <span className="text-orange-500 dark:text-orange-400">
                        🍻 {tVoting("diningShort")}:{" "}
                        <strong>{session.dinerCount + totalGuestDine}</strong>{" "}
                        <span className="text-foreground/80">
                          {t("people")}
                        </span>
                        {totalGuestDine > 0 && (
                          <span className="tabular-nums">
                            {" "}
                            <span className="text-foreground/80">
                              ({t("including")}{" "}
                            </span>
                            {totalGuestDine}{" "}
                            <span className="text-foreground/80">
                              {t("guest")})
                            </span>
                          </span>
                        )}
                      </span>
                    </div>
                    <ChevronDown
                      className={`text-muted-foreground h-5 w-5 shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                    />
                  </button>

                  {isExpanded && (
                    <div
                      className="bg-background/40 border-t p-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {voteManagerNode}
                    </div>
                  )}
                </div>
              )
            : voteManagerNode}

          {/* Completed: counts (CLICK to expand attendee list) + payment status */}
          {membersCollapsible && effectiveStatus === "completed" && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onExpandedChange?.(!isExpanded);
                }}
                className="hover:bg-muted/40 inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5"
              >
                <span className="text-primary">
                  🏸{" "}
                  <strong>
                    {session.playerCount + session.guestPlayCount}
                  </strong>{" "}
                  <span className="text-foreground/80">{t("people")}</span>
                </span>
                <span className="text-orange-500 dark:text-orange-400">
                  🍻{" "}
                  <strong>{session.dinerCount + session.guestDineCount}</strong>{" "}
                  <span className="text-foreground/80">{t("people")}</span>
                </span>
                <ChevronDown
                  className={`text-muted-foreground h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                />
              </button>
              {/* Trong optimistic-finalize window, server chưa
                  insert sessionDebts → totalDebt=0, allPaid lừa user
                  thấy "✓ 0đ" tưởng đã trả hết. Hiện spinner "Đang
                  chốt sổ..." cho tới khi server revalidate trả về
                  totalDebt thật. */}
              {isFinalizing ? (
                <span className="text-muted-foreground ml-auto inline-flex items-center gap-1.5 text-sm">
                  <span className="border-muted-foreground/40 border-t-primary inline-block h-3 w-3 animate-spin rounded-full border-2" />
                  {t("closingBooks")}
                </span>
              ) : !allPaid ? (
                <button
                  onClick={() => onExpandedChange?.(!isExpanded)}
                  className="ml-auto inline-flex items-center gap-2 py-1 text-sm font-medium text-amber-600 dark:text-amber-400"
                >
                  <AlertTriangle className="h-4 w-4" />
                  {t("stillOwingAmount", {
                    amount: formatK(unpaidAmount),
                  })}
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                  />
                </button>
              ) : null}
              {/* Mở lại để sửa — reverse fund_deductions, xóa attendees
                  + debts, trả về voting. Confirm trước vì ảnh hưởng
                  balance của member. */}
              <Button
                variant="outline"
                size="sm"
                className="ml-auto gap-1.5 border-yellow-500/40 bg-yellow-500/10 text-yellow-700 hover:bg-yellow-500/20 dark:text-yellow-300"
                onClick={(e) => {
                  e.stopPropagation();
                  onReopenCompleted?.();
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t("reopen")}
              </Button>
            </div>
          )}

          {membersCollapsible && effectiveStatus === "cancelled" && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-muted-foreground">
                🏸 {session.playerCount + session.guestPlayCount} {t("people")}
              </span>
              <span className="text-muted-foreground">
                🍻 {session.dinerCount + session.guestDineCount} {t("people")}
              </span>
              {/* Mở lại — đưa buổi về voting để admin sửa lại config. */}
              <Button
                variant="success"
                size="sm"
                className="ml-auto gap-1.5"
                onClick={(e) => {
                  e.stopPropagation();
                  onReopenCancelled?.();
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t("reopen")}
              </Button>
            </div>
          )}

          {/* Expanded — attendee list + unpaid debts. Inline trong
              cùng CardContent (border-t divider). */}
          {membersCollapsible &&
            isExpanded &&
            effectiveStatus === "completed" && (
              <div className="space-y-3 border-t pt-3">
                {(() => {
                  const players = session.attendees.filter(
                    (a) => a.attendsPlay,
                  );
                  const diners = session.attendees.filter((a) => a.attendsDine);
                  const renderAttendee = (
                    a: AdminSessionCardAttendee,
                    idx: number,
                  ) => {
                    const isAdminGuest =
                      a.isGuest &&
                      adminMemberId !== null &&
                      a.invitedById === adminMemberId;
                    return (
                      <div
                        key={`${a.memberId ?? "g"}-${a.guestName ?? ""}-${idx}`}
                        className="bg-muted/30 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                      >
                        {a.isGuest ? (
                          <span
                            className={cn(
                              "inline-flex h-7 w-7 items-center justify-center rounded-full text-xs",
                              isAdminGuest
                                ? "bg-blue-500/20"
                                : "bg-amber-500/20",
                            )}
                          >
                            {isAdminGuest ? "🎟" : "👤"}
                          </span>
                        ) : (
                          <MemberAvatar
                            memberId={a.memberId ?? 0}
                            avatarKey={a.memberAvatarKey}
                            avatarUrl={a.memberAvatarUrl}
                            size={28}
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">
                            {a.isGuest
                              ? isAdminGuest
                                ? t("guestAdmin")
                                : (a.guestName ?? t("guestLabel"))
                              : (a.memberName ?? `#${a.memberId}`)}
                          </p>
                          {a.isGuest && !isAdminGuest && a.invitedByName && (
                            <p className="text-muted-foreground truncate text-xs">
                              {t("guestOf", {
                                name: a.invitedByName,
                              })}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  };
                  return (
                    <>
                      {players.length > 0 && (
                        <div>
                          <p className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">
                            🏸{" "}
                            {t("attendeePlay", {
                              count: players.length,
                            })}
                          </p>
                          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                            {players.map(renderAttendee)}
                          </div>
                        </div>
                      )}
                      {diners.length > 0 && (
                        <div>
                          <p className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">
                            🍻{" "}
                            {t("attendeeDine", {
                              count: diners.length,
                            })}
                          </p>
                          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                            {diners.map(renderAttendee)}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}

                {optimisticUnpaidDebts.length > 0 && (
                  <div className="space-y-2 border-t pt-3">
                    <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                      {t("stillOwing")}
                    </p>
                    {optimisticUnpaidDebts.map((d) => (
                      <div
                        key={d.memberId}
                        className="flex items-center justify-between py-2 text-sm"
                      >
                        <div className="flex items-center gap-3">
                          <MemberAvatar
                            memberId={d.memberId}
                            avatarKey={d.memberAvatarKey}
                            avatarUrl={d.memberAvatarUrl}
                            size={28}
                          />
                          <span>{d.memberName}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-destructive font-medium">
                            {formatK(d.amount)}
                          </span>
                          <Button
                            size="sm"
                            variant="success"
                            className="gap-1"
                            onClick={() =>
                              onConfirmPayment?.(d.debtId, d.memberName)
                            }
                          >
                            <Check className="h-4 w-4" />
                            {tF("received")}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
        </CardContent>
      </Card>
    </LedBorder>
  );
}

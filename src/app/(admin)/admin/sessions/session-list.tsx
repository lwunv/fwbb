"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { parseAsInteger, useQueryState } from "nuqs";
import {
  createSessionManually,
  cancelSession,
  reopenSession,
  unlockSession,
  setAdminGuestCount,
} from "@/actions/sessions";
import { confirmPaymentByAdmin, finalizeSessionAuto } from "@/actions/finance";
import { fireAction } from "@/lib/optimistic-action";
import { useOptimisticSet } from "@/lib/optimistic-ui";
import { formatK, cn } from "@/lib/utils";
import {
  computeShuttlecockTotal,
  computePerHeadCharges,
} from "@/lib/cost-calculator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { CourtSelector } from "@/components/sessions/court-selector";
import { ShuttlecockSelector } from "@/components/sessions/shuttlecock-selector";
import { AdminVoteManager } from "@/components/sessions/admin-vote-manager";
import { MinDeductionToggle } from "@/components/sessions/min-deduction-toggle";
import { WeekStrip } from "@/components/sessions/week-strip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CustomSelect } from "@/components/ui/custom-select";
import {
  Plus,
  Calendar,
  MapPin,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Navigation,
  AlertTriangle,
  X,
  Check,
  RotateCcw,
} from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import { TabSegment } from "@/components/shared/tab-segment";
import { LedBorder } from "@/components/shared/led-border";
import { usePolling } from "@/lib/use-polling";
import {
  formatSessionDate as fmtSessionDate,
  getNextSessionDay,
  ymdInVN,
} from "@/lib/date-format";
import type { InferSelectModel } from "drizzle-orm";
import type {
  votes as votesTable,
  members as membersTable,
  courts as courtsTable,
  shuttlecockBrands as brandsTable,
  sessionShuttlecocks as sessionShuttlecocksTable,
} from "@/db/schema";

type Vote = InferSelectModel<typeof votesTable> & {
  member: InferSelectModel<typeof membersTable>;
};
type Court = InferSelectModel<typeof courtsTable>;
type Brand = InferSelectModel<typeof brandsTable>;
type SessionShuttlecock = InferSelectModel<typeof sessionShuttlecocksTable> & {
  brand: Brand;
};
type Member = InferSelectModel<typeof membersTable>;

interface UnpaidDebt {
  debtId: number;
  memberId: number;
  memberName: string;
  memberAvatarKey: string | null;
  memberAvatarUrl: string | null;
  amount: number;
}

interface SessionCard {
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
  unpaidDebts: UnpaidDebt[];
  shuttlecockInfo: { brandName: string; quantity: number }[];
  votes: Vote[];
  shuttlecocks: SessionShuttlecock[];
  debtMap: Record<
    number,
    { amount: number; adminConfirmed: boolean; debtId: number }
  >;
}

type SessionStatus = "voting" | "confirmed" | "completed" | "cancelled";

/**
 * Filter dropdown ở đầu list. Khác `SessionStatus` ở chỗ:
 * - "voting" trong filter = active upcoming/today (gồm cả status `confirmed`).
 * - "needsConfirm" là derived state — past pending — không phải status thật.
 * - "all" = không filter.
 */
export type StatusFilter =
  | "all"
  | "voting"
  | "needsConfirm"
  | "completed"
  | "cancelled";

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
    cardBg: "ring-blue-300/50 dark:ring-blue-700/40",
  },
  cancelled: {
    labelKey: "cancelled",
    // Buổi hủy: nền xám-đỏ desaturated để dễ phân biệt với active card (pink/white)
    // — không chỉ ring outline mỏng. Opacity giảm thêm cảm giác "không còn relevant".
    cardBg:
      "bg-zinc-100 dark:bg-zinc-800/40 ring-red-300/60 dark:ring-red-700/40 opacity-85",
  },
};

const DEFAULT_DATE = getNextSessionDay().toISOString().split("T")[0];

export function SessionList({
  sessions,
  courts = [],
  members = [],
  brands = [],
  currentPage = 1,
  totalPages = 1,
  currentStatusFilter = "all",
  defaultCourtId = null,
  sessionDays,
}: {
  sessions: SessionCard[];
  courts?: Court[];
  members?: Member[];
  brands?: Brand[];
  currentPage?: number;
  totalPages?: number;
  currentStatusFilter?: StatusFilter;
  defaultCourtId?: number | null;
  /** Lịch ngày chơi từ getSessionDaysOfWeek() — cần để CourtSelector preview
   *  đúng giá khi admin đã đổi lịch khỏi mặc định M/W/F. */
  sessionDays?: readonly number[] | number[];
}) {
  const [, setPage] = useQueryState(
    "page",
    parseAsInteger.withDefault(1).withOptions({ shallow: false }),
  );
  // Status filter — đổi filter reset page về 1 (server fetch lại slice mới).
  const [, setStatusFilter] = useQueryState("status", {
    defaultValue: "all",
    shallow: false,
    clearOnDefault: true,
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState("");
  const [cancelledSessions, setCancelledSessions] = useState<Set<number>>(
    new Set(),
  );
  const [cancelTarget, setCancelTarget] = useState<number | null>(null);
  const [cancelPassed, setCancelPassed] = useState(true);
  const [cancelPassRevenue, setCancelPassRevenue] = useState<string>("");
  // Unlock = mở lại buổi đã completed để sửa. Confirm vì sẽ reverse các
  // fund_deduction đã trừ quỹ → balance member sẽ thay đổi.
  const [unlockTarget, setUnlockTarget] = useState<number | null>(null);
  const [unlockedSessions, setUnlockedSessions] = useState<Set<number>>(
    new Set(),
  );
  // Optimistic finalize — admin bấm "Xác nhận buổi chơi" → status đổi ngay
  // sang "completed" cho UI; rollback tự động nếu finalize fail. useOptimisticSet
  // dùng functional updater nên 2 buổi finalize concurrent không stomp nhau.
  const finalizing = useOptimisticSet<number>();
  const finalizingSessions = finalizing.set;
  // Optimistic confirm-payment — debtId nào đã được admin bấm "Đã nhận"
  // (chưa server-revalidated) sẽ filter khỏi unpaidDebts list ngay.
  const paidDebts = useOptimisticSet<number>();
  const paidDebtIds = paidDebts.set;
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [localAdminGuests, setLocalAdminGuests] = useState<
    Record<number, { play: number; dine: number }>
  >({});
  const [selectedCourtId, setSelectedCourtId] = useState("");
  const t = useTranslations("sessions");
  const tF = useTranslations("finance");
  const tVoting = useTranslations("voting");
  const tFundAdmin = useTranslations("fundAdmin");
  usePolling();

  // Tính 1 lần / render thay vì gọi `ymdInVN()` lặp trong .map() bên dưới.
  const todayYmd = ymdInVN();

  // Auto-prune optimistic sets khi server đã converge — tránh memory growth
  // và tránh stale flag che data thật. finalizingSessions: drop khi
  // session.status="completed" thật. paidDebtIds: drop khi debtId không còn
  // trong unpaidDebts (tức server đã ghi nhận đã thanh toán).
  useEffect(() => {
    const completedIds = new Set(
      sessions.filter((s) => s.status === "completed").map((s) => s.id),
    );
    const allUnpaidDebtIds = new Set<number>();
    for (const s of sessions) {
      for (const d of s.unpaidDebts) allUnpaidDebtIds.add(d.debtId);
    }

    finalizing.setSet((prev) => {
      let changed = false;
      const next = new Set<number>();
      for (const id of prev) {
        if (completedIds.has(id)) {
          changed = true;
        } else {
          next.add(id);
        }
      }
      return changed ? next : prev;
    });

    paidDebts.setSet((prev) => {
      let changed = false;
      const next = new Set<number>();
      for (const id of prev) {
        if (!allUnpaidDebtIds.has(id)) {
          changed = true;
        } else {
          next.add(id);
        }
      }
      return changed ? next : prev;
    });

    // Cancelled / unlocked sets cũng converge khi server status khớp.
    setCancelledSessions((prev) => {
      let changed = false;
      const next = new Set<number>();
      const cancelledIds = new Set(
        sessions.filter((s) => s.status === "cancelled").map((s) => s.id),
      );
      for (const id of prev) {
        if (cancelledIds.has(id)) {
          changed = true;
        } else {
          next.add(id);
        }
      }
      return changed ? next : prev;
    });
    setUnlockedSessions((prev) => {
      let changed = false;
      const next = new Set<number>();
      const votingIds = new Set(
        sessions
          .filter((s) => s.status === "voting" || s.status === "confirmed")
          .map((s) => s.id),
      );
      for (const id of prev) {
        if (votingIds.has(id)) {
          changed = true;
        } else {
          next.add(id);
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- finalizing/paidDebts setters are stable from useOptimisticSet.
  }, [sessions]);

  function handleCreate(formData: FormData) {
    const date = formData.get("date") as string;
    if (!date) {
      setError(t("pleaseSelectDate"));
      return;
    }
    const startTime = (formData.get("startTime") as string) || undefined;
    const endTime = (formData.get("endTime") as string) || undefined;
    const courtIdRaw = formData.get("courtId") as string;
    const courtId = courtIdRaw ? Number(courtIdRaw) : undefined;
    setDialogOpen(false);
    setError("");
    fireAction(
      () => createSessionManually(date, startTime, endTime, courtId),
      () => {
        setDialogOpen(true);
        setError(t("createFailed") ?? "Failed");
      },
    );
  }

  function handleCancelConfirm() {
    if (!cancelTarget) return;
    const id = cancelTarget;
    const passed = cancelPassed;
    const passRevenue = passed
      ? Math.max(0, parseInt(cancelPassRevenue, 10) || 0)
      : 0;
    setCancelledSessions((prev) => new Set(prev).add(id));
    setCancelTarget(null);
    fireAction(
      () => cancelSession(id, { passed, passRevenue }),
      () =>
        setCancelledSessions((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        }),
    );
  }

  function getAdminGuests(sessionId: number, session: SessionCard) {
    return (
      localAdminGuests[sessionId] ?? {
        play: session.adminGuestPlayCount,
        dine: session.adminGuestDineCount,
      }
    );
  }

  function formatSessionDate(dateStr: string) {
    return fmtSessionDate(dateStr, "weekdayLong");
  }

  function toggleExpand(e: React.MouseEvent, sessionId: number) {
    e.preventDefault();
    e.stopPropagation();
    setExpandedId(expandedId === sessionId ? null : sessionId);
  }

  return (
    <Dialog
      open={dialogOpen}
      onOpenChange={(open) => {
        setDialogOpen(open);
        if (!open) setError("");
      }}
    >
      <div className="mx-auto max-w-3xl">
        {/* max-w-3xl mx-auto — desktop không rải card full width (dễ đọc,
            vibes mobile-first). "Tạo buổi chơi" giờ inline với filter chips,
            không còn fixed bottom bar nữa. */}
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("createSessionTitle")}</DialogTitle>
          </DialogHeader>
          <form action={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="date">{t("date")}</Label>
              <Input
                id="date"
                name="date"
                type="date"
                defaultValue={DEFAULT_DATE}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t("startTime")}</Label>
                <TimeSelect15 name="startTime" defaultValue="20:30" />
              </div>
              <div className="space-y-2">
                <Label>{t("endTime")}</Label>
                <TimeSelect15 name="endTime" defaultValue="22:30" />
              </div>
            </div>
            {courts.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="courtId">{t("court")}</Label>
                <CustomSelect
                  value={selectedCourtId}
                  onChange={setSelectedCourtId}
                  name="courtId"
                  placeholder={t("noCourt")}
                  options={courts.map((c) => ({
                    value: String(c.id),
                    label: c.name,
                  }))}
                />
              </div>
            )}
            {error && <p className="text-destructive text-sm">{error}</p>}
            <Button type="submit" className="w-full">
              {t("create")}
            </Button>
          </form>
        </DialogContent>

        {/* Top bar — filter chips (left, scroll-x trên mobile) + Tạo buổi chơi
            (right, không bị filter đẩy ra ngoài viewport). */}
        <div className="mb-3 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <TabSegment<StatusFilter>
              variant="pills"
              value={currentStatusFilter}
              onChange={(v) => setStatusFilter(v === "all" ? null : v)}
              options={[
                { value: "all", label: t("filterAll") },
                { value: "voting", label: t("filterUpcoming") },
                { value: "needsConfirm", label: tF("needsConfirm") },
                { value: "completed", label: t("completed") },
                { value: "cancelled", label: t("cancelled") },
              ]}
            />
          </div>
          <DialogTrigger
            render={
              <Button size="sm" className="h-9 shrink-0 gap-1 px-3 text-sm" />
            }
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">{t("createSession")}</span>
          </DialogTrigger>
        </div>

        <div className="grid gap-3">
          {sessions.map((session) => {
            // Optimistic status overrides — priority order matters:
            // 1. cancelledSessions: cancel optimistic (pending server)
            // 2. finalizingSessions: finalize optimistic → past-pending vừa bấm
            //    "Xác nhận" → hiển thị như completed cho tới khi server revalidate.
            // 3. unlockedSessions: unlock optimistic → đã completed nhưng admin
            //    vừa bấm "Mở lại" → hiển thị như voting.
            // Assumption: 1 buổi không thể đồng thời ở nhiều set tại 1 thời
            // điểm — finalizing chỉ flip từ voting/confirmed; unlock chỉ flip
            // từ completed; cancel có thể từ bất kỳ active state nào và win
            // tất cả. Auto-prune ở useEffect bên trên drop entry khi server
            // converge nên không tích lũy stale.
            const rawStatus = cancelledSessions.has(session.id)
              ? "cancelled"
              : finalizingSessions.has(session.id)
                ? "completed"
                : unlockedSessions.has(session.id)
                  ? "voting"
                  : (session.status ?? "voting");
            const effectiveStatus: SessionStatus = (
              ["voting", "confirmed", "completed", "cancelled"].includes(
                rawStatus,
              )
                ? rawStatus
                : "voting"
            ) as SessionStatus;
            const status = statusStyles[effectiveStatus];
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
            const allPaid =
              effectiveStatus === "completed" && unpaidAmount <= 0;
            const isExpanded = expandedId === session.id;
            const isActive =
              effectiveStatus === "voting" || effectiveStatus === "confirmed";
            // Buổi đã qua nhưng vẫn ở voting/confirmed → admin chưa chốt sổ.
            // Tách visual khỏi "đang vote" để LED xanh chỉ giữ cho buổi sắp/đang
            // diễn ra (yêu cầu UX), còn buổi này hiện amber + badge "Cần xác nhận".
            const isPastPending = isActive && session.date < todayYmd;
            // Cho phép admin finalize từ HÔM NAY (đánh xong là chốt được ngay).
            // Future session vẫn block — chốt sớm thì lỗi thiếu attendees thật.
            const canFinalize = isActive && session.date <= todayYmd;
            const isFinalizing = finalizingSessions.has(session.id);
            const cardBgClass = isPastPending
              ? "bg-card border-rose-400 border-2 ring-2 ring-rose-200/50 dark:ring-rose-900/30"
              : status.cardBg;
            const badgeVariant = isPastPending
              ? "needsConfirm"
              : effectiveStatus;
            const badgeText = isPastPending
              ? tF("needsConfirm")
              : t(status.labelKey);
            const ag = getAdminGuests(session.id, session);
            const totalGuestPlay =
              session.guestPlayCount + ag.play - session.adminGuestPlayCount;
            const totalGuestDine =
              session.guestDineCount + ag.dine - session.adminGuestDineCount;

            // Per-head & total — dùng cùng helper với cost-calculator để đồng bộ
            // 3 trang admin (list / detail / dashboard).
            const courtPriceVal = session.courtPrice ?? 0;
            // Round-UP-tổng (đồng bộ calculateSessionCosts). Per-brand round
            // rồi sum sẽ inflate 1-2k → preview lệch debt thực.
            const shuttlecockCost = computeShuttlecockTotal(
              session.shuttlecocks,
            );
            const totalPlayers = session.playerCount + totalGuestPlay;
            const totalDiners = session.dinerCount + totalGuestDine;
            const { playCostPerHead, dineCostPerHead } = computePerHeadCharges({
              courtPrice: courtPriceVal,
              shuttlecockCost,
              diningBill: session.diningBill,
              playerCount: totalPlayers,
              dinerCount: totalDiners,
            });
            const totalExpense =
              courtPriceVal + shuttlecockCost + session.diningBill;

            const showLed = isActive && !isPastPending;
            return (
              <div key={session.id}>
                <LedBorder active={showLed} variant="pink">
                  <Card className={cn("relative", cardBgClass)}>
                    <CardContent className="space-y-2 p-4">
                      {/* Header: Date + Status */}
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="space-y-1.5">
                            <p className="flex items-center gap-2 text-base font-bold capitalize">
                              <Calendar className="text-muted-foreground h-5 w-5" />
                              {formatSessionDate(session.date)}
                            </p>
                            <WeekStrip
                              sessionDate={session.date}
                              className="justify-center"
                            />
                          </div>
                          {(session.startTime || session.endTime) && (
                            <p className="text-muted-foreground mt-1 text-sm whitespace-nowrap">
                              ⏰ {session.startTime ?? "—"} –{" "}
                              {session.endTime ?? "—"}
                            </p>
                          )}
                          {session.courtName && (
                            <p className="text-muted-foreground mt-1 flex min-w-0 flex-nowrap items-center gap-2 text-sm">
                              <MapPin className="h-4 w-4 shrink-0" />
                              <span className="truncate">
                                {session.courtName}
                              </span>
                              {session.courtMapLink && (
                                <span
                                  role="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    window.open(
                                      session.courtMapLink!,
                                      "_blank",
                                    );
                                  }}
                                  className="text-primary inline-flex shrink-0 items-center gap-1"
                                >
                                  <Navigation className="h-4 w-4" />
                                  {t("directions")}
                                </span>
                              )}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="inline-flex">
                            <StatusBadge variant={badgeVariant}>
                              {badgeText}
                            </StatusBadge>
                          </div>
                          {isActive && (
                            <Button
                              variant="destructive"
                              size="icon-sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setCancelTarget(session.id);
                                setCancelPassed(true);
                                setCancelPassRevenue(
                                  String(session.courtPrice ?? 200000),
                                );
                              }}
                              aria-label={t("ariaCancelSession")}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Past pending CTA giờ inline cùng hàng "Tổng chi" bên
                      dưới (button trái, totals phải) — không tách block riêng
                      full-width nữa để tiết kiệm không gian. */}

                      {/* Court + Shuttlecock selectors — luôn hiện cho buổi active
                      VÀ past pending. Past pending cần edit court/shuttle để
                      finalize đúng (admin có thể chốt lại số quả thực dùng,
                      thay sân nếu hôm đó đổi sân, v.v.). */}
                      {isActive && (
                        <div
                          className="space-y-2 pt-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <CourtSelector
                            sessionId={session.id}
                            courts={courts}
                            currentCourtId={session.courtId}
                            currentCourtQuantity={session.courtQuantity}
                            sessionDate={session.date}
                            defaultCourtId={defaultCourtId}
                            sessionDays={sessionDays}
                          />
                          <ShuttlecockSelector
                            sessionId={session.id}
                            brands={brands}
                            currentShuttlecocks={session.shuttlecocks}
                          />
                          <MinDeductionToggle
                            sessionId={session.id}
                            enabled={session.useMinDeduction}
                            exemptCount={session.exemptMemberIds.length}
                          />
                        </div>
                      )}

                      {/* Admin guest stepper đã chuyển vào trong AdminVoteManager
                      (hiện ở khu mở rộng danh sách thành viên, trên search box). */}

                      {/* Tóm tắt chi phí — format đồng bộ với row Court/Shuttle:
                      [icon + label trái] ... [số tiền right-align, bold tabular].
                      Hiện cho mọi status trừ cancelled khi có dữ liệu. Số khi
                      chưa completed là ước tính (đổi nếu thêm/bớt người). */}
                      {effectiveStatus !== "cancelled" &&
                        (totalExpense > 0 ||
                          playCostPerHead > 0 ||
                          dineCostPerHead > 0 ||
                          canFinalize) && (
                          <div className="pt-1 text-base">
                            {/* Buổi hôm nay/past pending: button "Xác nhận" nằm BÊN TRÁI
                            cùng hàng với Tổng chi (right-align) → tiết kiệm không gian
                            + CTA gần con số tổng admin cần verify. */}
                            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 font-bold">
                              {canFinalize ? (
                                <button
                                  type="button"
                                  disabled={isFinalizing}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    // Optimistic: đánh dấu finalizing → status
                                    // xanh "completed" cho UI ngay; rollback tự
                                    // động nếu server fail (vd thiếu courtPrice).
                                    finalizing.addOptimistically(
                                      session.id,
                                      () => finalizeSessionAuto(session.id),
                                      {
                                        successMsg: t("confirmedSuccess"),
                                      },
                                    );
                                  }}
                                  className="bg-primary hover:bg-primary/90 active:bg-primary/95 shadow-primary/30 hover:shadow-primary/40 inline-flex h-[42px] w-1/2 shrink-0 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  <Check className="h-4 w-4" />
                                  {isFinalizing
                                    ? t("confirming")
                                    : t("confirmSession")}
                                </button>
                              ) : (
                                <span className="min-w-0 flex-1">
                                  💰 Tổng chi
                                </span>
                              )}
                              <span className="ml-auto flex items-center gap-1.5">
                                {!canFinalize ? null : (
                                  <span className="font-semibold">
                                    💰 Tổng chi
                                  </span>
                                )}
                                <span className="text-primary text-lg font-bold tabular-nums">
                                  {formatK(totalExpense)}
                                </span>
                                {(playCostPerHead > 0 ||
                                  dineCostPerHead > 0) && (
                                  <span className="text-foreground/70 text-base font-semibold tabular-nums">
                                    (
                                    {playCostPerHead > 0 && (
                                      <span className="text-primary">
                                        🏸 {formatK(playCostPerHead)}
                                      </span>
                                    )}
                                    {playCostPerHead > 0 &&
                                      dineCostPerHead > 0 && (
                                        <span className="text-foreground/50">
                                          {" "}
                                          ·{" "}
                                        </span>
                                      )}
                                    {dineCostPerHead > 0 && (
                                      <span className="text-orange-500 dark:text-orange-400">
                                        🍻 {formatK(dineCostPerHead)}
                                      </span>
                                    )}
                                    <span className="text-foreground/70 text-sm font-medium">
                                      /người)
                                    </span>
                                  </span>
                                )}
                              </span>
                            </div>
                          </div>
                        )}

                      {/* Members block — toggle + danh sách trong CÙNG 1 card chung,
                      border chung. Toggle collapsed = thấy stat tổng; expanded =
                      mở rộng AdminVoteManager (member list) ngay bên dưới với
                      `border-t` divider. Không tách block ra ngoài Card nữa. */}
                      {isActive && (
                        <div
                          className={`border-primary/25 bg-primary/[0.04] overflow-hidden rounded-xl border transition-colors ${
                            isExpanded
                              ? "border-primary/50"
                              : "hover:border-primary/40"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={(e) => toggleExpand(e, session.id)}
                            className="flex w-full items-center justify-between p-3 text-base"
                          >
                            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-left">
                              <span className="text-primary">
                                🏸 {tVoting("badmintonShort")}:{" "}
                                <strong>
                                  {session.playerCount + totalGuestPlay}
                                </strong>{" "}
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
                                <strong>
                                  {session.dinerCount + totalGuestDine}
                                </strong>{" "}
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
                              <AdminVoteManager
                                sessionId={session.id}
                                votes={session.votes}
                                members={members}
                                debtMap={session.debtMap}
                                readOnly={false}
                                adminGuestPlayCount={ag.play}
                                adminGuestDineCount={ag.dine}
                                onAdminGuestChange={(play, dine) => {
                                  // Optimistic local update + revert on server fail.
                                  // Cùng path với handleAdminGuestChange cũ — chỉ
                                  // hợp nhất 2 field thành 1 callback.
                                  const prev = getAdminGuests(
                                    session.id,
                                    session,
                                  );
                                  const next = { play, dine };
                                  setLocalAdminGuests((s) => ({
                                    ...s,
                                    [session.id]: next,
                                  }));
                                  fireAction(
                                    () =>
                                      setAdminGuestCount(
                                        session.id,
                                        next.play,
                                        next.dine,
                                      ),
                                    () =>
                                      setLocalAdminGuests((s) => ({
                                        ...s,
                                        [session.id]: prev,
                                      })),
                                  );
                                }}
                                minDeductionEnabled={session.useMinDeduction}
                                exemptMemberIds={session.exemptMemberIds}
                                sessionCosts={{
                                  courtPrice: session.courtPrice ?? 0,
                                  courtName: session.courtName,
                                  diningBill: session.diningBill,
                                  shuttlecocks: session.shuttlecocks.map(
                                    (s) => ({
                                      brandName: s.brand?.name ?? "",
                                      quantity: s.quantityUsed,
                                      pricePerTube: s.pricePerTube,
                                    }),
                                  ),
                                  startTime: session.startTime ?? "20:30",
                                  endTime: session.endTime ?? "22:30",
                                  isCompleted: false,
                                }}
                                hideCostSummary
                              />
                            </div>
                          )}
                        </div>
                      )}

                      {/* Completed: counts (non-expandable) + payment status */}
                      {effectiveStatus === "completed" && (
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                          <span className="text-primary">
                            🏸{" "}
                            <strong>
                              {session.playerCount + session.guestPlayCount}
                            </strong>{" "}
                            <span className="text-foreground/80">
                              {t("people")}
                            </span>
                          </span>
                          <span className="text-orange-500 dark:text-orange-400">
                            🍻{" "}
                            <strong>
                              {session.dinerCount + session.guestDineCount}
                            </strong>{" "}
                            <span className="text-foreground/80">
                              {t("people")}
                            </span>
                          </span>
                          {/* Trong optimistic-finalize window, server chưa
                          insert sessionDebts → totalDebt=0, allPaid lừa user
                          thấy "✓ 0đ" tưởng đã trả hết. Hiện spinner "Đang
                          chốt sổ..." cho tới khi server revalidate trả về
                          totalDebt thật. */}
                          {finalizingSessions.has(session.id) ? (
                            <span className="text-muted-foreground ml-auto inline-flex items-center gap-1.5 text-sm">
                              <span className="border-muted-foreground/40 border-t-primary inline-block h-3 w-3 animate-spin rounded-full border-2" />
                              Đang chốt sổ...
                            </span>
                          ) : allPaid ? (
                            <span className="ml-auto text-sm font-medium text-green-600 dark:text-green-400">
                              ✓ {formatK(session.totalDebt)}
                            </span>
                          ) : (
                            <button
                              onClick={() =>
                                setExpandedId(isExpanded ? null : session.id)
                              }
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
                          )}
                          {/* Mở lại để sửa — reverse fund_deductions, xóa attendees
                          + debts, trả về voting. Confirm trước vì ảnh hưởng
                          balance của member. */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setUnlockTarget(session.id);
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-2.5 py-1 text-xs font-medium text-yellow-700 transition-colors hover:bg-yellow-500/20 dark:text-yellow-300"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Mở lại
                          </button>
                        </div>
                      )}

                      {effectiveStatus === "cancelled" && (
                        <div className="flex flex-wrap items-center gap-3 text-sm">
                          <span className="text-muted-foreground">
                            🏸 {session.playerCount + session.guestPlayCount}{" "}
                            {t("people")}
                          </span>
                          <span className="text-muted-foreground">
                            🍻 {session.dinerCount + session.guestDineCount}{" "}
                            {t("people")}
                          </span>
                          {/* Mở lại — đưa buổi về voting để admin sửa lại config.
                          Nếu đã có pass-sân, server reverse fund_contribution
                          qua reversalOfId (audit trail đầy đủ). */}
                          <Button
                            variant="success"
                            size="sm"
                            className="ml-auto gap-1.5"
                            onClick={(e) => {
                              e.stopPropagation();
                              // Optimistic: bỏ khỏi cancelledSessions set để hiện
                              // lại như active (sau revalidate sẽ về voting thật).
                              setCancelledSessions((prev) => {
                                const n = new Set(prev);
                                n.delete(session.id);
                                return n;
                              });
                              fireAction(
                                () => reopenSession(session.id),
                                () =>
                                  setCancelledSessions((prev) =>
                                    new Set(prev).add(session.id),
                                  ),
                              );
                            }}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Mở lại
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </LedBorder>

                {/* AdminVoteManager đã chuyển vào trong Card phía trên (gộp chung
                  border với toggle counts). Không còn block tách rời ở đây. */}

                {/* Expanded: unpaid debts for completed sessions — đã filter
                  paidDebtIds để row biến mất ngay khi admin bấm "Đã nhận". */}
                {isExpanded &&
                  effectiveStatus === "completed" &&
                  optimisticUnpaidDebts.length > 0 && (
                    <div className="bg-background/50 divide-y rounded-b-xl border border-t-0 p-4">
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
                              onClick={() => {
                                const debtId = d.debtId;
                                const memberName = d.memberName;
                                // Wrap action để toast lỗi gắn member name —
                                // admin click nhiều row liên tiếp vẫn biết
                                // row nào fail.
                                paidDebts.addOptimistically(
                                  debtId,
                                  async () => {
                                    const r =
                                      await confirmPaymentByAdmin(debtId);
                                    if (r && "error" in r && r.error) {
                                      return {
                                        error: `${memberName}: ${r.error}`,
                                      };
                                    }
                                    return r;
                                  },
                                );
                              }}
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
            );
          })}

          {sessions.length === 0 && (
            <div className="text-muted-foreground py-12 text-center">
              {t("noSessions")}
            </div>
          )}
        </div>

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-3">
            <Button
              variant="outline"
              size="icon"
              disabled={currentPage <= 1}
              onClick={() => setPage(Math.max(1, currentPage - 1))}
              className="h-11 w-11"
              aria-label={t("ariaPrevPage")}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-muted-foreground min-w-[5rem] text-center text-sm tabular-nums">
              Trang <strong className="text-foreground">{currentPage}</strong> /{" "}
              {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              disabled={currentPage >= totalPages}
              onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
              className="h-11 w-11"
              aria-label={t("ariaNextPage")}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        <ConfirmDialog
          open={cancelTarget !== null}
          onOpenChange={(open) => {
            if (!open) setCancelTarget(null);
          }}
          title={t("cancelSession")}
          description={t("cancelConfirm")}
          onConfirm={handleCancelConfirm}
          confirmLabel={t("cancelSessionConfirmLabel")}
        >
          <div className="space-y-3">
            <label className="hover:bg-accent/40 flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors">
              <input
                type="checkbox"
                checked={cancelPassed}
                onChange={(e) => setCancelPassed(e.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">Pass được sân</div>
                <div className="text-muted-foreground text-xs">
                  Tick nếu admin đã thu được tiền từ team khác. Tiền sẽ tự động
                  vào quỹ admin.
                </div>
              </div>
            </label>
            {cancelPassed && (
              <div className="space-y-1.5">
                <label className="text-muted-foreground text-xs font-medium">
                  Số tiền nhận lại (VND)
                </label>
                <Input
                  type="text"
                  inputMode="numeric"
                  value={
                    cancelPassRevenue
                      ? Number(cancelPassRevenue).toLocaleString("vi-VN")
                      : ""
                  }
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "");
                    setCancelPassRevenue(digits);
                  }}
                  placeholder={tFundAdmin("passRevenuePlaceholder")}
                  className="tabular-nums"
                />
                <p className="text-muted-foreground text-xs">
                  Mặc định = giá thuê sân của buổi. Có thể chỉnh nếu khác.
                </p>
              </div>
            )}
          </div>
        </ConfirmDialog>

        {/* Confirm mở lại buổi đã completed — reverse tài chính + clear attendees/debts */}
        <ConfirmDialog
          open={unlockTarget !== null}
          onOpenChange={(open) => {
            if (!open) setUnlockTarget(null);
          }}
          title={t("reopenCompletedTitle")}
          description="Hệ thống sẽ hoàn lại các khoản trừ quỹ, xóa danh sách attendees và debts của buổi này. Sau đó admin có thể sửa lại thông tin và bấm 'Xác nhận buổi chơi' để chốt sổ lại."
          confirmLabel="Mở lại"
          onConfirm={() => {
            if (!unlockTarget) return;
            const id = unlockTarget;
            setUnlockTarget(null);
            // Optimistic: đánh dấu đã unlock để UI đổi style ngay; rollback nếu fail
            setUnlockedSessions((prev) => new Set(prev).add(id));
            fireAction(
              () => unlockSession(id),
              () =>
                setUnlockedSessions((prev) => {
                  const n = new Set(prev);
                  n.delete(id);
                  return n;
                }),
            );
          }}
        />
      </div>
    </Dialog>
  );
}

/**
 * Time picker giới hạn phút theo mốc 15p (00 / 15 / 30 / 45). Native
 * `<input type="time">` Chrome vẫn cho chọn mọi phút dù có `step="900"`,
 * nên dùng 2 select tùy chọn + hidden input để form chấp nhận giá trị HH:MM.
 *
 * Khi `defaultValue` không nằm trên mốc (e.g. "20:35"), round xuống mốc gần
 * nhất (35 → 30) để dropdown match được option hiện có.
 */
function TimeSelect15({
  name,
  defaultValue,
}: {
  name: string;
  defaultValue: string;
}) {
  const [hRaw, mRaw] = defaultValue.split(":");
  const hInit = String(parseInt(hRaw ?? "0", 10) || 0).padStart(2, "0");
  const mInitNum = parseInt(mRaw ?? "0", 10) || 0;
  const mInit = String(Math.floor(mInitNum / 15) * 15).padStart(2, "0");
  const [hh, setHh] = useState(hInit);
  const [mm, setMm] = useState(mInit);
  const combined = `${hh}:${mm}`;

  const hourOptions = Array.from({ length: 24 }, (_, i) => ({
    value: String(i).padStart(2, "0"),
    label: `${String(i).padStart(2, "0")}h`,
  }));
  const minuteOptions = ["00", "15", "30", "45"].map((m) => ({
    value: m,
    label: m,
  }));

  return (
    <div className="flex gap-2">
      <input type="hidden" name={name} value={combined} />
      <CustomSelect
        value={hh}
        onChange={setHh}
        options={hourOptions}
        className="flex-1"
      />
      <CustomSelect
        value={mm}
        onChange={setMm}
        options={minuteOptions}
        className="flex-1"
      />
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
  computePredictedPlayRevenue,
  computePredictedMinDeductionSurplus,
} from "@/lib/cost-calculator";
import { deriveSessionBadge } from "@/lib/session-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminSessionCard } from "@/components/sessions/admin-session-card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CustomSelect } from "@/components/ui/custom-select";
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  List,
} from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import { TabSegment } from "@/components/shared/tab-segment";
import { DateRangePicker } from "@/components/shared/date-range-picker";
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
  member: import("@/lib/optimistic-votes").PublicMember;
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

interface AttendeeInfo {
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
  unpaidDebts: UnpaidDebt[];
  shuttlecockInfo: { brandName: string; quantity: number }[];
  votes: Vote[];
  shuttlecocks: SessionShuttlecock[];
  debtMap: Record<
    number,
    { amount: number; adminConfirmed: boolean; debtId: number }
  >;
  attendees: AttendeeInfo[];
  voteDeadline: string | null;
  maxPlayers: number;
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

const DEFAULT_DATE = getNextSessionDay().toISOString().split("T")[0];

export function SessionList({
  sessions,
  courts = [],
  members = [],
  brands = [],
  currentPage = 1,
  totalPages = 1,
  currentStatusFilter = "all",
  currentFrom = null,
  currentTo = null,
  defaultCourtId = null,
  sessionDays,
  memberBalances = {},
  adminMemberId = null,
  weekDays = [],
}: {
  sessions: SessionCard[];
  courts?: Court[];
  members?: Member[];
  brands?: Brand[];
  currentPage?: number;
  totalPages?: number;
  currentStatusFilter?: StatusFilter;
  /** Khoảng ngày lọc (YYYY-MM-DD) — server đã áp vào query, đây chỉ để prefill input. */
  currentFrom?: string | null;
  currentTo?: string | null;
  /** "cards" = thẻ đầy đủ (mặc định); "list" = danh sách gọn 1 dòng/buổi. */
  viewMode?: "cards" | "list";
  defaultCourtId?: number | null;
  /** Lịch ngày chơi từ getSessionDaysOfWeek() — cần để CourtSelector preview
   *  đúng giá khi admin đã đổi lịch khỏi mặc định M/W/F. */
  sessionDays?: readonly number[] | number[];
  /** Map memberId → fund balance, thread vào AdminVoteManager để render
   *  warning icon (Task 5a) cạnh tên member trong row. */
  memberBalances?: Record<number, number>;
  /** Admin's memberId — guests có invitedById trùng = "Khách Admin" (quỹ
   *  chung chi), khác = "Khách của X" (member X tự chi). */
  adminMemberId?: number | null;
  /** Tuần đích (T2/4/6) cho selector đầu trang: chip cuộn tới buổi đã có / mở
   *  dialog tạo (prefill ngày) cho ngày chưa có. */
  weekDays?: {
    date: string;
    sessionId: number | null;
    status: string | null;
  }[];
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
  // Date-range — shallow:false để server fetch lại slice theo filter.
  const [, setFrom] = useQueryState("from", {
    defaultValue: "",
    shallow: false,
    clearOnDefault: true,
  });
  const [, setTo] = useQueryState("to", {
    defaultValue: "",
    shallow: false,
    clearOnDefault: true,
  });
  // View (thẻ/list) chỉ là cách RENDER cùng data → shallow (client-side, KHÔNG
  // refetch server) nên đổi TỨC THÌ, mượt, không cần loading. Đọc value từ
  // nuqs để render (thay cho prop server trước đây phải round-trip).
  const [viewParam, setView] = useQueryState("view", {
    defaultValue: "cards",
    clearOnDefault: true,
  });
  const viewMode: "cards" | "list" = viewParam === "list" ? "list" : "cards";
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
  // Create dialog date controllable → chip "ngày chưa có buổi" prefill được.
  const [createDate, setCreateDate] = useState(DEFAULT_DATE);

  function openCreateFor(date: string) {
    setCreateDate(date);
    setSelectedCourtId("");
    setError("");
    setDialogOpen(true);
  }
  function scrollToSession(id: number) {
    document
      .getElementById(`session-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const t = useTranslations("sessions");
  const tF = useTranslations("finance");
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
                value={createDate}
                onChange={(e) => setCreateDate(e.target.value)}
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

        {/* Selector tuần đích (T2/4/6, như trang user) — chip CÓ buổi: cuộn tới
            card; chip CHƯA có (dashed +): mở dialog tạo buổi prefill đúng ngày. */}
        {weekDays.length > 0 && (
          <div className="bg-card/60 mb-3 rounded-xl border p-3">
            <p className="text-muted-foreground mb-2 text-xs font-medium">
              {t("thisWeek")}
            </p>
            {/* Chips ngày + nút "Tạo buổi" CÙNG 1 hàng. Nút icon-only trên
                mobile (chữ hiện từ sm:) để không bị đẩy xuống dòng. */}
            <div className="flex flex-wrap items-center gap-1.5">
              {weekDays.map((d) => {
                const has = d.sessionId !== null;
                const done =
                  d.status === "completed" || d.status === "cancelled";
                return (
                  <button
                    key={d.date}
                    type="button"
                    onClick={() =>
                      has
                        ? scrollToSession(d.sessionId!)
                        : openCreateFor(d.date)
                    }
                    className={cn(
                      "inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium capitalize transition-colors",
                      has
                        ? done
                          ? "bg-muted text-muted-foreground border-transparent"
                          : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                        : "text-muted-foreground hover:bg-accent border-dashed",
                    )}
                  >
                    {fmtSessionDate(d.date, "weekdayName")}
                    {!has && <Plus className="h-3.5 w-3.5" />}
                  </button>
                );
              })}
              <Button
                size="sm"
                className="ml-auto shrink-0 gap-1 px-3"
                onClick={() => openCreateFor(DEFAULT_DATE)}
                title={t("createSession")}
                aria-label={t("createSession")}
              >
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">{t("createSession")}</span>
              </Button>
            </div>
          </div>
        )}

        {/* Bộ lọc + công cụ. Chips trạng thái ở HÀNG RIÊNG full-width (cuộn
            ngang sạch); tách khỏi nút "+" để dải chip không bị nút đè lên +
            cắt mất như bản cũ. Hàng dưới: khoảng ngày + đổi kiểu xem (icon
            lưới/danh sách) + tạo buổi. */}
        <div className="mb-3 space-y-3">
          <TabSegment<StatusFilter>
            variant="pills"
            scrollable={false}
            className="flex-wrap"
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
          <div className="flex flex-wrap items-end gap-2">
            {/* Khoảng ngày — bỏ label chữ (theo yêu cầu), chỉ còn control ngày. */}
            <div className="min-w-0 flex-1">
              <DateRangePicker
                from={currentFrom}
                to={currentTo}
                placeholder={t("filterDateRange")}
                onFromChange={(v) => {
                  setPage(1);
                  setFrom(v);
                }}
                onToChange={(v) => {
                  setPage(1);
                  setTo(v);
                }}
                onClear={() => {
                  setPage(1);
                  setFrom(null);
                  setTo(null);
                }}
              />
            </div>
            <div className="ml-auto flex items-center gap-2">
              {/* Đổi kiểu xem: 2 nút icon (lưới = thẻ, danh sách = list gọn). */}
              <div
                role="group"
                aria-label={`${t("viewCards")} / ${t("viewList")}`}
                className="bg-muted inline-flex shrink-0 items-center gap-1 rounded-full p-1"
              >
                <button
                  type="button"
                  aria-label={t("viewCards")}
                  title={t("viewCards")}
                  aria-pressed={viewMode === "cards"}
                  onClick={() => setView(null)}
                  className={cn(
                    "inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors",
                    viewMode === "cards"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label={t("viewList")}
                  title={t("viewList")}
                  aria-pressed={viewMode === "list"}
                  onClick={() => setView("list")}
                  className={cn(
                    "inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors",
                    viewMode === "list"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <List className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {sessions.length === 0 && (
          <p className="text-muted-foreground py-10 text-center text-sm">
            {t("noSessionsFilter")}
          </p>
        )}

        {/* Chế độ danh sách gọn: 1 dòng/buổi, bấm mở trang quản lý chi tiết. */}
        {viewMode === "list" && sessions.length > 0 && (
          <div className="divide-border/60 bg-card overflow-hidden rounded-xl border">
            {sessions.map((session) => {
              const rawStatus = cancelledSessions.has(session.id)
                ? "cancelled"
                : finalizingSessions.has(session.id)
                  ? "completed"
                  : unlockedSessions.has(session.id)
                    ? "voting"
                    : (session.status ?? "voting");
              const {
                variant: badgeVariant,
                labelKey,
                isPastPending,
              } = deriveSessionBadge(rawStatus, session.date, todayYmd);
              const badgeText = isPastPending
                ? tF("needsConfirm")
                : t(labelKey);
              const unpaidCount = session.unpaidDebts.filter(
                (d) => !paidDebtIds.has(d.debtId),
              ).length;
              // Tiền cho list (tổng chi + /người + Lãi/Lỗ) — DÙNG CÙNG helper
              // với card view để số KHÔNG lệch.
              const listAg = getAdminGuests(session.id, session);
              const listGuestPlay =
                session.guestPlayCount +
                listAg.play -
                session.adminGuestPlayCount;
              const listGuestDine =
                session.guestDineCount +
                listAg.dine -
                session.adminGuestDineCount;
              const listShuttleCost = computeShuttlecockTotal(
                session.shuttlecocks,
              );
              const listPlayers = session.playerCount + listGuestPlay;
              const listDiners = session.dinerCount + listGuestDine;
              const {
                playCostPerHead: listPlayPerHead,
                adminGuestPlayCostPerHead: listAgPlayPerHead,
                dineCostPerHead: listDinePerHead,
              } = computePerHeadCharges({
                courtPrice: session.courtPrice ?? 0,
                shuttlecockCost: listShuttleCost,
                diningBill: session.diningBill,
                playerCount: listPlayers,
                dinerCount: listDiners,
                adminGuestPlayHeads: listAg.play,
              });
              const listTotalExpense =
                (session.courtPrice ?? 0) +
                listShuttleCost +
                session.diningBill;
              const listShowRevenue =
                rawStatus === "completed" || isPastPending;
              const listRevenue =
                rawStatus === "completed"
                  ? session.totalDebt
                  : computePredictedPlayRevenue({
                      totalPlayHeads: listPlayers,
                      adminGuestPlayHeads: listAg.play,
                      playCostPerHead: listPlayPerHead,
                      adminGuestPlayCostPerHead: listAgPlayPerHead,
                    }) +
                    listDiners * listDinePerHead +
                    (session.useMinDeduction
                      ? computePredictedMinDeductionSurplus({
                          playingMemberIds: session.votes
                            .filter((v) => v.willPlay)
                            .map((v) => v.member.id),
                          memberBalances,
                          exemptMemberIds: session.exemptMemberIds,
                          playCostPerHead: listPlayPerHead,
                        })
                      : 0);
              const listProfit = listShowRevenue
                ? listRevenue - listTotalExpense
                : null;
              return (
                <Link
                  key={session.id}
                  href={`/admin/sessions/${session.id}`}
                  className="hover:bg-muted/40 flex min-h-[3.25rem] items-center gap-3 border-b px-3 py-2.5 transition-colors last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-sm font-semibold capitalize">
                        {fmtSessionDate(session.date, "weekdayName")}
                      </span>
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {fmtSessionDate(session.date, "short")}
                      </span>
                      {(session.startTime || session.endTime) && (
                        <span className="text-muted-foreground text-xs tabular-nums">
                          · {session.startTime ?? "—"}–{session.endTime ?? "—"}
                        </span>
                      )}
                    </div>
                    <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                      <span className="tabular-nums">
                        🏸 {session.playerCount + session.guestPlayCount}
                      </span>
                      <span className="tabular-nums">
                        🍻 {session.dinerCount + session.guestDineCount}
                      </span>
                      <span className="tabular-nums">
                        💰 {formatK(listTotalExpense)}
                      </span>
                      {session.courtName && (
                        <span className="min-w-0 truncate">
                          · {session.courtName}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                      {listPlayPerHead > 0 && (
                        <span className="text-primary tabular-nums">
                          🏸 {formatK(listPlayPerHead)}/ng
                        </span>
                      )}
                      {listDinePerHead > 0 && (
                        <span className="text-orange-600 tabular-nums dark:text-orange-400">
                          🍻 {formatK(listDinePerHead)}/ng
                        </span>
                      )}
                      {listProfit !== null && (
                        <span
                          className={cn(
                            "font-semibold tabular-nums",
                            listProfit > 0
                              ? "text-green-600 dark:text-green-400"
                              : listProfit < 0
                                ? "text-rose-600 dark:text-rose-400"
                                : "text-muted-foreground",
                          )}
                        >
                          📊{" "}
                          {listProfit > 0
                            ? "Lãi"
                            : listProfit < 0
                              ? "Lỗ"
                              : "Hòa"}{" "}
                          {listProfit > 0 ? "+" : listProfit < 0 ? "−" : ""}
                          {formatK(Math.abs(listProfit))}
                        </span>
                      )}
                    </div>
                  </div>
                  {unpaidCount > 0 && (
                    <span className="bg-destructive/15 text-destructive shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums">
                      {t("unpaidCountShort", { count: unpaidCount })}
                    </span>
                  )}
                  <StatusBadge variant={badgeVariant}>{badgeText}</StatusBadge>
                  <ChevronRight className="text-muted-foreground h-4 w-4 shrink-0" />
                </Link>
              );
            })}
          </div>
        )}

        {viewMode === "cards" && (
          // grid-cols-1 = minmax(0,1fr) cho phép cột CO dưới content: nếu
          // 1 thẻ có child rộng (vd hàng deadline) sẽ tự truncate/wrap trong
          // thẻ thay vì kéo cả grid rộng hơn viewport → hết cắt bên phải.
          <div className="grid grid-cols-1 gap-3">
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
              const isActive =
                effectiveStatus === "voting" || effectiveStatus === "confirmed";
              // Badge derivation shared with AdminSessionCard + session-detail.
              const badge = deriveSessionBadge(
                effectiveStatus,
                session.date,
                todayYmd,
              );
              const isPastPending = badge.isPastPending;
              // Cho phép admin finalize từ HÔM NAY (đánh xong là chốt được ngay).
              // Future session vẫn block — chốt sớm thì lỗi thiếu attendees thật.
              const canFinalize = isActive && session.date <= todayYmd;
              const isFinalizing = finalizingSessions.has(session.id);
              const isExpanded = expandedId === session.id;
              const ag = getAdminGuests(session.id, session);
              return (
                <div
                  key={session.id}
                  id={`session-${session.id}`}
                  className="min-w-0 scroll-mt-4"
                >
                  <AdminSessionCard
                    session={session}
                    effectiveStatus={effectiveStatus}
                    isPastPending={isPastPending}
                    badge={badge}
                    courts={courts}
                    brands={brands}
                    members={members}
                    memberBalances={memberBalances}
                    defaultCourtId={defaultCourtId}
                    sessionDays={sessionDays}
                    adminMemberId={adminMemberId}
                    adminGuestPlay={ag.play}
                    adminGuestDine={ag.dine}
                    onAdminGuestChange={(play, dine) => {
                      // Optimistic local update + revert on server fail. Cùng
                      // path với handleAdminGuestChange cũ — hợp nhất 2 field
                      // thành 1 callback.
                      const prev = getAdminGuests(session.id, session);
                      const next = { play, dine };
                      setLocalAdminGuests((s) => ({
                        ...s,
                        [session.id]: next,
                      }));
                      fireAction(
                        () =>
                          setAdminGuestCount(session.id, next.play, next.dine),
                        () =>
                          setLocalAdminGuests((s) => ({
                            ...s,
                            [session.id]: prev,
                          })),
                      );
                    }}
                    paidDebtIds={paidDebtIds}
                    onConfirmPayment={(debtId, memberName) => {
                      const idempotencyKey = crypto.randomUUID();
                      // Wrap action để toast lỗi gắn member name — admin click
                      // nhiều row liên tiếp vẫn biết row nào fail.
                      paidDebts.addOptimistically(debtId, async () => {
                        const r = await confirmPaymentByAdmin(
                          debtId,
                          idempotencyKey,
                        );
                        if (r && "error" in r && r.error) {
                          return { error: `${memberName}: ${r.error}` };
                        }
                        return r;
                      });
                    }}
                    onCancel={() => {
                      setCancelTarget(session.id);
                      setCancelPassed(true);
                      setCancelPassRevenue(
                        String(session.courtPrice ?? 200000),
                      );
                    }}
                    canFinalize={canFinalize}
                    isFinalizing={isFinalizing}
                    onFinalize={() => {
                      finalizing.addOptimistically(
                        session.id,
                        () => finalizeSessionAuto(session.id),
                        { successMsg: t("confirmedSuccess") },
                      );
                    }}
                    onReopenCompleted={() => setUnlockTarget(session.id)}
                    onReopenCancelled={() => {
                      // Optimistic: bỏ khỏi cancelledSessions set để hiện lại
                      // như active (sau revalidate về voting thật).
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
                    membersCollapsible
                    expanded={isExpanded}
                    onToggleExpand={(e) => toggleExpand(e, session.id)}
                    onExpandedChange={(next) =>
                      setExpandedId(next ? session.id : null)
                    }
                  />
                </div>
              );
            })}
          </div>
        )}

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
              {t.rich("pageOf", {
                current: currentPage,
                total: totalPages,
                b: (chunks) => (
                  <strong className="text-foreground">{chunks}</strong>
                ),
              })}
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
                <div className="text-sm font-medium">{t("passCourtLabel")}</div>
                <div className="text-muted-foreground text-xs">
                  {t("passCourtHint")}
                </div>
              </div>
            </label>
            {cancelPassed && (
              <div className="space-y-1.5">
                <label className="text-muted-foreground text-xs font-medium">
                  {t("passRevenueLabel")}
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
                  {t("passRevenueHint")}
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
          description={t("reopenCompletedDesc")}
          confirmLabel={t("reopen")}
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

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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CustomSelect } from "@/components/ui/custom-select";
import {
  Plus,
  Calendar,
  Clock,
  MapPin,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Navigation,
  AlertTriangle,
  X,
  Check,
  RotateCcw,
  LayoutGrid,
  List,
} from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import { TabSegment } from "@/components/shared/tab-segment";
import { DateRangeFilter } from "@/components/shared/date-range-filter";
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
  viewMode = "cards",
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
  // Date-range + view mode — cùng shallow:false để server fetch lại slice.
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
  const [, setView] = useQueryState("view", {
    defaultValue: "cards",
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
            {/* Header box: tiêu đề "Tuần này" (trái) + nút tạo buổi mới (phải). */}
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-muted-foreground text-xs font-medium">
                {t("thisWeek")}
              </p>
              <Button
                size="sm"
                className="shrink-0 gap-1 px-3"
                onClick={() => openCreateFor(DEFAULT_DATE)}
              >
                <Plus className="h-4 w-4" />
                {t("createSession")}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
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
              <DateRangeFilter
                from={currentFrom}
                to={currentTo}
                fromAriaLabel={t("filterFrom")}
                toAriaLabel={t("filterTo")}
                clearAriaLabel={t("filterClearDates")}
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
                    "inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors",
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
                    "inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors",
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
              return (
                <Link
                  key={session.id}
                  href={`/admin/sessions/${session.id}`}
                  className="hover:bg-muted/40 flex min-h-[3.25rem] items-center gap-3 border-b px-3 py-2.5 transition-colors last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold capitalize">
                        {fmtSessionDate(session.date, "weekdayName")}
                      </span>
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {fmtSessionDate(session.date, "short")}
                      </span>
                    </div>
                    <div className="text-muted-foreground mt-0.5 flex items-center gap-2 text-xs">
                      <span className="tabular-nums">
                        🏸 {session.playerCount + session.guestPlayCount}
                      </span>
                      <span className="tabular-nums">
                        🍻 {session.dinerCount + session.guestDineCount}
                      </span>
                      {session.courtName && (
                        <span className="truncate">· {session.courtName}</span>
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
              // Badge derivation shared with session-card + session-detail.
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
              // Cần xác nhận (buổi quá hạn chưa chốt sổ): border VÀNG.
              const cardBgClass = isPastPending
                ? "bg-card border-amber-400 border-2 ring-2 ring-amber-200/50 dark:border-amber-500 dark:ring-amber-900/30"
                : status.cardBg;
              const badgeVariant = badge.variant;
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
              const {
                playCostPerHead,
                adminGuestPlayCostPerHead,
                dineCostPerHead,
              } = computePerHeadCharges({
                courtPrice: courtPriceVal,
                shuttlecockCost,
                diningBill: session.diningBill,
                playerCount: totalPlayers,
                dinerCount: totalDiners,
                // Khách-của-admin trả sàn 60K → preview khớp finalize.
                adminGuestPlayHeads: ag.play,
              });
              const totalExpense =
                courtPriceVal + shuttlecockCost + session.diningBill;

              const showLed = isActive && !isPastPending;
              return (
                <div
                  key={session.id}
                  id={`session-${session.id}`}
                  className="min-w-0 scroll-mt-4"
                >
                  <LedBorder active={showLed} variant="pink">
                    <Card className={cn("relative", cardBgClass)}>
                      <CardContent className="space-y-2 p-4">
                        {/* Header: Date + Status */}
                        {/* Hàng 1: ngày + giờ (trái) · trạng thái + huỷ (phải). */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                            <p className="flex items-center gap-2 text-base font-bold capitalize">
                              <Calendar className="text-muted-foreground h-5 w-5 shrink-0" />
                              {formatSessionDate(session.date)}
                            </p>
                            {(session.startTime || session.endTime) && (
                              <span className="text-muted-foreground inline-flex items-center gap-1.5 text-sm whitespace-nowrap tabular-nums">
                                <Clock className="h-4 w-4" />
                                {session.startTime ?? "—"} –{" "}
                                {session.endTime ?? "—"}
                              </span>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
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

                        {/* Dãy thứ — FULL WIDTH (7 ô chia đều 1 hàng). */}
                        <WeekStrip
                          sessionDate={session.date}
                          className="w-full"
                        />

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

                        {/* Past pending CTA giờ inline cùng hàng "Tổng chi" bên
                      dưới (button trái, totals phải) — không tách block riêng
                      full-width nữa để tiết kiệm không gian. */}

                        {/* Court + Shuttlecock selectors — luôn hiện cho buổi active
                      VÀ past pending. Past pending cần edit court/shuttle để
                      finalize đúng (admin có thể chốt lại số quả thực dùng,
                      thay sân nếu hôm đó đổi sân, v.v.). */}
                        {isActive && (
                          <div
                            className="space-y-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <CourtSelector
                              sessionId={session.id}
                              courts={courts}
                              currentCourtId={session.courtId}
                              currentCourtQuantity={session.courtQuantity}
                              currentCourtPrice={session.courtPrice}
                              isCourtPriceOverridden={
                                session.courtPriceOverridden
                              }
                              sessionDate={session.date}
                              defaultCourtId={defaultCourtId}
                              sessionDays={sessionDays}
                            />
                            <ShuttlecockSelector
                              sessionId={session.id}
                              brands={brands}
                              currentShuttlecocks={session.shuttlecocks}
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

                        {/* Admin guest stepper đã chuyển vào trong AdminVoteManager
                      (hiện ở khu mở rộng danh sách thành viên, trên search box). */}

                        {/* Tóm tắt Chi vs Thu vs Lãi/Lỗ — 3-column stat tile
                          để admin dễ so sánh. Logic Thu:
                          - completed: session.totalDebt (actual)
                          - past-pending: predicted Thu = totalPlayers × playPerHead
                            + totalDiners × dinePerHead (giả định tất cả attendees
                            là member-trả; admin's share không trừ ra trong preview)
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
                            const predictedPenaltySurplus =
                              session.useMinDeduction
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
                                    effectiveStatus === "completed"
                                      ? "actual"
                                      : "predicted"
                                  }
                                  canFinalize={canFinalize}
                                  isFinalizing={isFinalizing}
                                  onFinalize={() => {
                                    finalizing.addOptimistically(
                                      session.id,
                                      () => finalizeSessionAuto(session.id),
                                      { successMsg: t("confirmedSuccess") },
                                    );
                                  }}
                                  confirmLabel={t("confirmSession")}
                                  confirmingLabel={t("confirming")}
                                />
                              </div>
                            );
                          })()}

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
                                  memberBalances={memberBalances}
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

                        {/* Completed: counts (CLICK to expand attendee list) + payment status */}
                        {effectiveStatus === "completed" && (
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedId(isExpanded ? null : session.id);
                              }}
                              className="hover:bg-muted/40 inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5"
                            >
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
                              <ChevronDown
                                className={`text-muted-foreground h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                              />
                            </button>
                            {/* Trong optimistic-finalize window, server chưa
                          insert sessionDebts → totalDebt=0, allPaid lừa user
                          thấy "✓ 0đ" tưởng đã trả hết. Hiện spinner "Đang
                          chốt sổ..." cho tới khi server revalidate trả về
                          totalDebt thật. */}
                            {/* Thu/Lãi đã hiện trong stat card Tổng thu ở trên — không
                          lặp ở đây. Chỉ giữ:
                          - spinner khi đang chốt sổ
                          - cảnh báo "còn nợ" nếu có debt chưa thanh toán */}
                            {finalizingSessions.has(session.id) ? (
                              <span className="text-muted-foreground ml-auto inline-flex items-center gap-1.5 text-sm">
                                <span className="border-muted-foreground/40 border-t-primary inline-block h-3 w-3 animate-spin rounded-full border-2" />
                                {t("closingBooks")}
                              </span>
                            ) : !allPaid ? (
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
                            ) : null}
                            {/* Mở lại để sửa — reverse fund_deductions, xóa attendees
                          + debts, trả về voting. Confirm trước vì ảnh hưởng
                          balance của member. ml-auto đẩy về phải khi Thu/Lãi
                          đã chuyển vào stat card phía trên. */}
                            <Button
                              variant="outline"
                              size="sm"
                              className="ml-auto gap-1.5 border-yellow-500/40 bg-yellow-500/10 text-yellow-700 hover:bg-yellow-500/20 dark:text-yellow-300"
                              onClick={(e) => {
                                e.stopPropagation();
                                setUnlockTarget(session.id);
                              }}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              {t("reopen")}
                            </Button>
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
                              {t("reopen")}
                            </Button>
                          </div>
                        )}

                        {/* Expanded — attendee list + unpaid debts. Inline trong
                          cùng CardContent (border-t divider) để không tạo ra
                          card thứ 2 tách rời. */}
                        {isExpanded && effectiveStatus === "completed" && (
                          <div className="space-y-3 border-t pt-3">
                            {(() => {
                              const players = session.attendees.filter(
                                (a) => a.attendsPlay,
                              );
                              const diners = session.attendees.filter(
                                (a) => a.attendsDine,
                              );
                              const renderAttendee = (
                                a: AttendeeInfo,
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
                                      {a.isGuest &&
                                        !isAdminGuest &&
                                        a.invitedByName && (
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
                                        onClick={() => {
                                          const debtId = d.debtId;
                                          const memberName = d.memberName;
                                          const idempotencyKey =
                                            crypto.randomUUID();
                                          // Wrap action để toast lỗi gắn member name
                                          // — admin click nhiều row liên tiếp vẫn
                                          // biết row nào fail.
                                          paidDebts.addOptimistically(
                                            debtId,
                                            async () => {
                                              const r =
                                                await confirmPaymentByAdmin(
                                                  debtId,
                                                  idempotencyKey,
                                                );
                                              if (
                                                r &&
                                                "error" in r &&
                                                r.error
                                              ) {
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
                        )}
                      </CardContent>
                    </Card>
                  </LedBorder>
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

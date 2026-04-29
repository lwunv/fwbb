"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import type { Locale as DateFnsLocale } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { ChevronLeft, ChevronRight, Banknote, ChevronDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PaymentQR } from "@/components/payment/payment-qr";
import { computePerHeadCharges } from "@/lib/cost-calculator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { formatK } from "@/lib/utils";
import { usePolling } from "@/lib/use-polling";
import { cn } from "@/lib/utils";
import {
  HistoryActivityIcons,
  type HistoryActivityKind,
  type HistoryDebtLite,
} from "./history-activity-icons";
import { HistoryPaymentStatus } from "./history-payment-status";

interface SessionAttendee {
  id: number;
  name: string;
  memberId: number | null;
  memberAvatarKey: string | null;
  memberAvatarUrl: string | null;
  isGuest: boolean;
  attendsPlay: boolean;
  attendsDine: boolean;
  debt: HistoryDebtLite | null;
}

interface MySessionSummary {
  attendsPlay: boolean;
  attendsDine: boolean;
  playShare: number;
  dineShare: number;
  totalShare: number;
  memberConfirmed: boolean;
  adminConfirmed: boolean;
  hasDebtRow: boolean;
  debtId: number | null;
}

export interface HistorySession {
  id: number;
  date: string;
  status: string;
  courtName: string;
  courtPrice: number;
  shuttlecockCost: number;
  diningBill: number;
  totalCost: number;
  playerCount: number;
  dinerCount: number;
  attendees: SessionAttendee[];
  mySummary: MySessionSummary | null;
}

interface HistoryClientProps {
  sessions: HistorySession[];
  isIdentified: boolean;
  currentMemberId: number | null;
}

function formatDateLabel(dateStr: string, locale: DateFnsLocale): string {
  try {
    const d = parseISO(dateStr);
    return format(d, "EEEE, dd/MM/yyyy", { locale });
  } catch {
    return dateStr;
  }
}

function ymd(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

function mySummaryToDebt(my: MySessionSummary): HistoryDebtLite | null {
  if (!my.hasDebtRow && my.totalShare <= 0) return null;
  return {
    playAmount: my.playShare,
    dineAmount: my.dineShare,
    totalAmount: my.totalShare,
    memberConfirmed: my.memberConfirmed,
    adminConfirmed: my.adminConfirmed,
  };
}

/** User còn tiền chưa được xác nhận thanh toán (cùng logic HistoryPaymentStatus). */
function mySummaryIsUnpaid(my: MySessionSummary): boolean {
  const debt = mySummaryToDebt(my);
  if (!debt || debt.totalAmount <= 0) return false;
  return !debt.memberConfirmed && !debt.adminConfirmed;
}

export function HistoryClient({
  sessions,
  isIdentified,
  currentMemberId,
}: HistoryClientProps) {
  const appLocale = useLocale();
  const dfLocale = useMemo(() => getDateFnsLocale(appLocale), [appLocale]);
  const t = useTranslations("history");
  const tVoting = useTranslations("voting");
  usePolling();

  const [viewMonth, setViewMonth] = useState(() =>
    sessions[0]
      ? startOfMonth(parseISO(sessions[0].date))
      : startOfMonth(new Date()),
  );
  const [selectedId, setSelectedId] = useState<number | null>(
    () => sessions[0]?.id ?? null,
  );

  const [detail, setDetail] = useState<{
    title: string;
    description: string;
  } | null>(null);

  const [allDebtsQROpen, setAllDebtsQROpen] = useState(true);

  const unpaidSessions = useMemo(
    () => sessions.filter((s) => s.mySummary && mySummaryIsUnpaid(s.mySummary)),
    [sessions],
  );
  const totalOwedAcrossSessions = useMemo(
    () =>
      unpaidSessions.reduce(
        (sum, s) => sum + (s.mySummary?.totalShare ?? 0),
        0,
      ),
    [unpaidSessions],
  );

  useEffect(() => {
    if (sessions.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- keep selection valid when refreshed data becomes empty.
      setSelectedId(null);
      return;
    }
    if (selectedId == null || !sessions.some((s) => s.id === selectedId)) {
      setSelectedId(sessions[0].id);
    }
  }, [sessions, selectedId]);

  const byDate = useMemo(() => {
    const m = new Map<string, HistorySession[]>();
    for (const s of sessions) {
      const arr = m.get(s.date) ?? [];
      arr.push(s);
      m.set(s.date, arr);
    }
    for (const [, arr] of m) {
      arr.sort((a, b) => b.id - a.id);
    }
    return m;
  }, [sessions]);

  const weekdayLabels = useMemo(() => {
    const anchor = startOfWeek(new Date(), { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(anchor);
      d.setDate(anchor.getDate() + i);
      return format(d, "EEE", { locale: dfLocale });
    });
  }, [dfLocale]);

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(viewMonth);
    const monthEnd = endOfMonth(viewMonth);
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [viewMonth]);

  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedId) ?? null,
    [sessions, selectedId],
  );

  const openActivityDetail = useCallback(
    (
      kind: HistoryActivityKind,
      opts: {
        name?: string;
        attendsPlay: boolean;
        attendsDine: boolean;
        debt: HistoryDebtLite | null;
        memberId: number | null;
      },
    ) => {
      const lines: string[] = [];
      let heading: string;

      if (kind === "play") {
        heading = tVoting("badmintonShort");
        lines.push(
          opts.attendsPlay ? t("participatedYes") : t("participatedNo"),
        );
        lines.push(`${t("playCost")}: ${formatK(opts.debt?.playAmount ?? 0)}`);
      } else {
        heading = tVoting("diningShort");
        lines.push(
          opts.attendsDine ? t("participatedYes") : t("participatedNo"),
        );
        lines.push(`${t("dineCost")}: ${formatK(opts.debt?.dineAmount ?? 0)}`);
      }

      const title = opts.name ? `${opts.name} — ${heading}` : heading;
      setDetail({ title, description: lines.filter(Boolean).join("\n") });
    },
    [t, tVoting],
  );

  const onDayClick = (day: Date) => {
    const key = ymd(day);
    const list = byDate.get(key);
    if (!list?.length) return;
    setSelectedId(list[0].id);
  };

  return (
    <div className="space-y-4">
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{detail?.title}</DialogTitle>
            <DialogDescription className="text-left whitespace-pre-line">
              {detail?.description}
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>

      {/* Pay-all-debts QR — chỉ khi user đã đăng nhập + còn nợ */}
      {isIdentified &&
        currentMemberId !== null &&
        totalOwedAcrossSessions > 0 && (
          <div className="border-destructive/30 bg-destructive/5 overflow-hidden rounded-xl border">
            <button
              type="button"
              onClick={() => setAllDebtsQROpen((v) => !v)}
              aria-expanded={allDebtsQROpen}
              className="hover:bg-destructive/10 flex w-full items-center justify-between gap-2 p-3 transition-colors"
            >
              <div className="flex items-center gap-2">
                <div className="bg-destructive/15 text-destructive rounded-lg p-1.5">
                  <Banknote className="h-4 w-4" />
                </div>
                <div className="text-left">
                  <div className="text-sm font-semibold">
                    {t("payAllDebts")}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {t("payAllDebtsDesc")}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-destructive text-base font-bold tabular-nums">
                  {formatK(totalOwedAcrossSessions)}
                </span>
                <ChevronDown
                  className={`text-muted-foreground h-4 w-4 transition-transform ${
                    allDebtsQROpen ? "rotate-180" : ""
                  }`}
                  aria-hidden
                />
              </div>
            </button>

            {allDebtsQROpen && (
              <div className="bg-muted/20 border-t p-3">
                <PaymentQR
                  amount={totalOwedAcrossSessions}
                  memo={`FWBB NO ${currentMemberId}`}
                />
              </div>
            )}
          </div>
        )}

      {/* Danh sách buổi còn nợ — click vào để xem chi tiết */}
      {isIdentified && unpaidSessions.length > 0 && (
        <Card className="border-destructive/20">
          <CardContent className="space-y-2 p-3">
            <div className="text-muted-foreground flex items-center justify-between text-xs font-semibold tracking-wide uppercase">
              <span>{t("unpaidSessions")}</span>
              <span className="text-destructive">{unpaidSessions.length}</span>
            </div>
            <div className="space-y-1.5">
              {unpaidSessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(s.id);
                    setViewMonth(startOfMonth(parseISO(s.date)));
                    if (typeof window !== "undefined") {
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }
                  }}
                  className={cn(
                    "hover:bg-destructive/10 flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition-colors",
                    selectedId === s.id && "bg-destructive/10",
                  )}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium capitalize">
                      {formatDateLabel(s.date, dfLocale)}
                    </div>
                    <div className="text-muted-foreground truncate text-xs">
                      {s.courtName}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-destructive text-sm font-bold tabular-nums">
                      {formatK(s.mySummary?.totalShare ?? 0)}
                    </span>
                    <ChevronRight className="text-muted-foreground h-4 w-4" />
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Lịch */}
      <Card className="border-border/80 gap-2 overflow-hidden py-2">
        <CardContent className="px-3 !py-0 sm:px-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setViewMonth((m) => addMonths(m, -1))}
              className="border-border bg-background hover:bg-muted/80 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-colors"
              aria-label={t("prevMonth")}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs font-semibold capitalize tabular-nums sm:text-sm">
              {format(viewMonth, "LLLL yyyy", { locale: dfLocale })}
            </span>
            <button
              type="button"
              onClick={() => setViewMonth((m) => addMonths(m, 1))}
              className="border-border bg-background hover:bg-muted/80 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-colors"
              aria-label={t("nextMonth")}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="text-muted-foreground mb-1.5 grid grid-cols-7 gap-1.5 text-center text-sm font-medium">
            {weekdayLabels.map((w, i) => {
              const isClubDayColumn = i === 0 || i === 4;
              return (
                <div
                  key={w}
                  className={cn(
                    "truncate rounded px-0 py-0.5 leading-tight",
                    isClubDayColumn &&
                      "bg-primary/12 text-foreground dark:bg-primary/20 font-semibold",
                  )}
                >
                  {w}
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-7 gap-1.5">
            {calendarDays.map((day) => {
              const key = ymd(day);
              const onMonth = isSameMonth(day, viewMonth);
              const list = byDate.get(key);
              const hasSession = !!list?.length;
              const hasUnpaidSession =
                isIdentified &&
                !!list?.some(
                  (s) => s.mySummary && mySummaryIsUnpaid(s.mySummary),
                );
              const userPlayed =
                isIdentified && !!list?.some((s) => s.mySummary?.attendsPlay);
              const userDined =
                isIdentified && !!list?.some((s) => s.mySummary?.attendsDine);
              const isSelected =
                !!selectedSession && selectedSession.date === key && hasSession;
              const dow = day.getDay();
              const isClubDayColumn = dow === 1 || dow === 5;
              const today = isToday(day);

              return (
                <button
                  key={key + String(day.getTime())}
                  type="button"
                  disabled={!hasSession}
                  onClick={() => onDayClick(day)}
                  className={cn(
                    "relative min-h-11 overflow-hidden rounded-md py-1 text-sm font-medium transition-colors sm:min-h-11",
                    !onMonth && "opacity-35",
                    !hasSession && "cursor-default opacity-50",
                    hasSession &&
                      hasUnpaidSession &&
                      "border-destructive/50 bg-destructive/20 text-destructive dark:bg-destructive/30 border dark:text-red-200",
                    hasSession &&
                      !hasUnpaidSession &&
                      !userPlayed &&
                      "border border-[var(--color-hist-play-border)] bg-[var(--color-hist-play-bg)] text-[var(--color-hist-play-fg)]",
                    hasSession &&
                      !hasUnpaidSession &&
                      userPlayed &&
                      "border border-[var(--color-hist-play-border)] bg-[var(--color-hist-play-bg-strong)] text-[var(--color-hist-play-fg)]",
                    isClubDayColumn &&
                      !hasUnpaidSession &&
                      "before:bg-primary/[0.11] dark:before:bg-primary/[0.14] before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit]",
                    today &&
                      !isSelected &&
                      "ring-offset-background font-semibold ring-2 ring-sky-500/70 ring-offset-1 dark:ring-sky-400/65",
                    today && isSelected && "font-semibold",
                    isSelected &&
                      "ring-primary ring-offset-background ring-2 ring-offset-1",
                  )}
                >
                  <span className="relative z-[1] leading-none tabular-nums">
                    {format(day, "d")}
                  </span>
                  {hasSession && userDined && (
                    <span
                      className="absolute right-0.5 bottom-0.5 block h-1 w-1 rounded-full bg-orange-500 shadow-sm sm:h-1.5 sm:w-1.5 dark:bg-orange-400"
                      aria-hidden
                    />
                  )}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {!isIdentified && (
        <p className="text-muted-foreground text-xs">{t("signInToSeeShare")}</p>
      )}

      {/* Chi tiết buổi */}
      {selectedSession && (
        <SessionDetailCard
          session={selectedSession}
          isIdentified={isIdentified}
          currentMemberId={currentMemberId}
          dateLocale={dfLocale}
          openActivityDetail={openActivityDetail}
        />
      )}
    </div>
  );
}

function SessionDetailCard({
  session,
  isIdentified,
  currentMemberId,
  dateLocale,
  openActivityDetail,
}: {
  session: HistorySession;
  isIdentified: boolean;
  currentMemberId: number | null;
  dateLocale: DateFnsLocale;
  openActivityDetail: (
    kind: HistoryActivityKind,
    opts: {
      name?: string;
      attendsPlay: boolean;
      attendsDine: boolean;
      debt: HistoryDebtLite | null;
      memberId: number | null;
    },
  ) => void;
}) {
  const t = useTranslations("history");
  const isCompleted = session.status === "completed";
  const my = session.mySummary;
  const myDebt = my ? mySummaryToDebt(my) : null;
  const sharePaid = !!(myDebt?.adminConfirmed || myDebt?.memberConfirmed);
  const shareHasDebt = (myDebt?.totalAmount ?? 0) > 0;

  // Per-head charges — share single source of truth with cost-calculator so
  // there's no risk of UI drift vs server-side finalize logic.
  const { playCostPerHead: playPerHead, dineCostPerHead: dinePerHead } =
    computePerHeadCharges({
      courtPrice: session.courtPrice,
      shuttlecockCost: session.shuttlecockCost,
      diningBill: session.diningBill,
      playerCount: session.playerCount,
      dinerCount: session.dinerCount,
    });

  return (
    <Card
      className={cn(
        "overflow-hidden border-[var(--color-hist-play-border)]/40 bg-[var(--color-hist-play-bg)]/30",
      )}
    >
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-[var(--color-hist-play-fg)] capitalize">
                {formatDateLabel(session.date, dateLocale)}
              </span>
              <Badge
                variant={isCompleted ? "secondary" : "destructive"}
                className="text-xs"
              >
                {isCompleted ? t("completed") : t("cancelled")}
              </Badge>
            </div>
            <p className="text-muted-foreground text-xs">{session.courtName}</p>
          </div>
        </div>

        {isIdentified && my && currentMemberId != null && (
          <div
            className="bg-background/60 dark:bg-background/40 flex flex-col gap-3 rounded-lg border border-[var(--color-hist-play-border)]/50 p-3"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <p className="text-muted-foreground text-xs leading-none font-semibold tracking-wide uppercase">
              {t("yourShare")}
            </p>
            <div className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <HistoryActivityIcons
                attendsPlay={my.attendsPlay}
                attendsDine={my.attendsDine}
                onIconClick={(kind) =>
                  openActivityDetail(kind, {
                    attendsPlay: my.attendsPlay,
                    attendsDine: my.attendsDine,
                    debt: myDebt,
                    memberId: currentMemberId,
                  })
                }
              />
              {isCompleted && (
                <HistoryPaymentStatus debtId={my.debtId} debt={myDebt} />
              )}
            </div>
            {isCompleted && (
              <div className="flex w-full flex-wrap items-baseline gap-x-4 gap-y-1 text-left text-xs">
                <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
                  <span className="text-muted-foreground">
                    {t("playCost")}:
                  </span>
                  <strong className="text-sm text-[var(--color-hist-play-fg)] tabular-nums">
                    {formatK(my.playShare)}
                  </strong>
                </span>
                <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
                  <span className="text-muted-foreground">
                    {t("dineCost")}:
                  </span>
                  <strong className="text-sm text-[var(--color-hist-dine-fg)] tabular-nums">
                    {formatK(my.dineShare)}
                  </strong>
                </span>
                <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
                  <span className="text-muted-foreground">
                    {t("totalShort")}:
                  </span>
                  <strong
                    className={cn(
                      "text-sm font-semibold tabular-nums",
                      shareHasDebt && !sharePaid
                        ? "text-destructive"
                        : sharePaid
                          ? "text-green-600 dark:text-green-400"
                          : "text-primary",
                    )}
                  >
                    {formatK(my.totalShare)}
                  </strong>
                </span>
              </div>
            )}
          </div>
        )}

        <div className={cn(isCompleted && "space-y-2")}>
          {isCompleted && (
            <h4 className="text-muted-foreground text-xs font-semibold uppercase">
              {t("costBreakdown")}
              <span className="text-primary pl-2 text-sm tabular-nums">
                {formatK(session.totalCost)}
              </span>
            </h4>
          )}
          <div className="grid items-stretch gap-2 sm:grid-cols-2">
            <div
              className={cn(
                "flex h-full min-h-0 flex-col gap-2 rounded-lg border px-3 py-2 text-sm",
                "border-[var(--color-hist-play-border)] bg-[var(--color-hist-play-bg)]",
              )}
            >
              {isCompleted && (
                <div className="space-y-1">
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground text-xs">
                      {t("court")}
                    </span>
                    <span className="text-[var(--color-hist-play-fg)] tabular-nums">
                      {formatK(session.courtPrice)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground text-xs">
                      {t("shuttlecock")}
                    </span>
                    <span className="text-[var(--color-hist-play-fg)] tabular-nums">
                      {formatK(session.shuttlecockCost)}
                    </span>
                  </div>
                </div>
              )}
              <div
                className={cn(
                  "mt-auto flex min-h-10 items-baseline gap-2 text-xs font-medium text-[var(--color-hist-play-fg)]",
                  isCompleted &&
                    "border-t border-[var(--color-hist-play-border)]/35 pt-2",
                )}
              >
                <span
                  className="shrink-0 text-base leading-none opacity-90 select-none"
                  aria-hidden
                >
                  🏸
                </span>
                <span>
                  {t("play")}{" "}
                  <strong className="text-base leading-none tabular-nums">
                    {session.playerCount}
                  </strong>
                </span>
                {isCompleted && playPerHead > 0 && (
                  <span className="ml-auto text-xs font-bold text-[var(--color-hist-play-fg)] tabular-nums">
                    {formatK(playPerHead)}
                    {t("perHead")}
                  </span>
                )}
              </div>
            </div>
            <div
              className={cn(
                "flex h-full min-h-0 flex-col gap-2 rounded-lg border px-3 py-2 text-sm",
                "border-[var(--color-hist-dine-border)] bg-[var(--color-hist-dine-bg)]",
              )}
            >
              {isCompleted && (
                <div className="space-y-1">
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground text-xs">
                      {t("dining")}
                    </span>
                    <span className="text-[var(--color-hist-dine-fg)] tabular-nums">
                      {formatK(session.diningBill)}
                    </span>
                  </div>
                </div>
              )}
              <div
                className={cn(
                  "mt-auto flex min-h-10 items-baseline gap-2 text-xs font-medium text-[var(--color-hist-dine-fg)]",
                  isCompleted &&
                    "border-t border-[var(--color-hist-dine-border)]/35 pt-2",
                )}
              >
                <span
                  className="shrink-0 text-base leading-none opacity-90 select-none"
                  aria-hidden
                >
                  🍻
                </span>
                <span>
                  {t("dine")}{" "}
                  <strong className="text-base leading-none tabular-nums">
                    {session.dinerCount}
                  </strong>
                </span>
                {isCompleted && dinePerHead > 0 && (
                  <span className="ml-auto text-xs font-bold text-[var(--color-hist-dine-fg)] tabular-nums">
                    {formatK(dinePerHead)}
                    {t("perHead")}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <h4 className="text-muted-foreground text-xs font-semibold uppercase">
            {t("participants")}
          </h4>
          <div className="space-y-2">
            {session.attendees.map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-sm">
                {a.memberId ? (
                  <MemberAvatar
                    memberId={a.memberId}
                    avatarKey={a.memberAvatarKey}
                    avatarUrl={a.memberAvatarUrl}
                    size={24}
                  />
                ) : (
                  <div className="bg-muted flex h-6 w-6 items-center justify-center rounded-full text-xs">
                    K
                  </div>
                )}
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    a.isGuest && "text-muted-foreground italic",
                  )}
                >
                  {a.name}
                  {a.isGuest && ` (${t("guest")})`}
                </span>
                <HistoryActivityIcons
                  attendsPlay={a.attendsPlay}
                  attendsDine={a.attendsDine}
                  onIconClick={(kind) =>
                    openActivityDetail(kind, {
                      name: a.name,
                      attendsPlay: a.attendsPlay,
                      attendsDine: a.attendsDine,
                      debt: a.debt,
                      memberId: a.memberId,
                    })
                  }
                />
              </div>
            ))}
          </div>
        </div>

        {!isCompleted && (
          <p className="text-muted-foreground border-border/60 border-t pt-3 text-sm">
            {t("sessionCancelled")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

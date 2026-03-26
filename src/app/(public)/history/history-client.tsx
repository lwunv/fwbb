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
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
    sessions[0] ? startOfMonth(parseISO(sessions[0].date)) : startOfMonth(new Date()),
  );
  const [selectedId, setSelectedId] = useState<number | null>(() => sessions[0]?.id ?? null);

  const [detail, setDetail] = useState<{ title: string; description: string } | null>(null);

  useEffect(() => {
    if (sessions.length === 0) {
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
        lines.push(opts.attendsPlay ? t("participatedYes") : t("participatedNo"));
        lines.push(`${t("playCost")}: ${formatK(opts.debt?.playAmount ?? 0)}`);
      } else {
        heading = tVoting("diningShort");
        lines.push(opts.attendsDine ? t("participatedYes") : t("participatedNo"));
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
            <DialogDescription className="whitespace-pre-line text-left">
              {detail?.description}
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>

      {/* Lịch */}
      <Card className="overflow-hidden border-border/80 py-2 gap-2">
        <CardContent className="px-3 !py-0 sm:px-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <button
              type="button"
              onClick={() => setViewMonth((m) => addMonths(m, -1))}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background hover:bg-muted/80 transition-colors"
              aria-label={t("prevMonth")}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="text-xs font-semibold capitalize tabular-nums sm:text-sm">
              {format(viewMonth, "LLLL yyyy", { locale: dfLocale })}
            </span>
            <button
              type="button"
              onClick={() => setViewMonth((m) => addMonths(m, 1))}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background hover:bg-muted/80 transition-colors"
              aria-label={t("nextMonth")}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mb-1.5 grid grid-cols-7 gap-1.5 text-center text-[10px] font-medium text-muted-foreground sm:text-[11px]">
            {weekdayLabels.map((w, i) => {
              const isClubDayColumn = i === 0 || i === 4;
              return (
                <div
                  key={w}
                  className={cn(
                    "truncate rounded px-0 py-0.5 leading-tight",
                    isClubDayColumn &&
                      "bg-primary/12 text-foreground font-semibold dark:bg-primary/20",
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
                !!list?.some((s) => s.mySummary && mySummaryIsUnpaid(s.mySummary));
              const userPlayed =
                isIdentified && !!list?.some((s) => s.mySummary?.attendsPlay);
              const userDined = isIdentified && !!list?.some((s) => s.mySummary?.attendsDine);
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
                    "relative min-h-[2rem] rounded-md py-0.5 text-[11px] font-medium transition-colors overflow-hidden sm:min-h-[2.25rem] sm:text-xs",
                    !onMonth && "opacity-35",
                    !hasSession && "cursor-default opacity-50",
                    hasSession &&
                      hasUnpaidSession &&
                      "border border-destructive/50 bg-destructive/20 text-destructive dark:bg-destructive/30 dark:text-red-200",
                    hasSession &&
                      !hasUnpaidSession &&
                      !userPlayed &&
                      "bg-[var(--color-hist-play-bg)] border border-[var(--color-hist-play-border)] text-[var(--color-hist-play-fg)]",
                    hasSession &&
                      !hasUnpaidSession &&
                      userPlayed &&
                      "bg-[var(--color-hist-play-bg-strong)] border border-[var(--color-hist-play-border)] text-[var(--color-hist-play-fg)]",
                    isClubDayColumn &&
                      !hasUnpaidSession &&
                      "before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:bg-primary/[0.11] dark:before:bg-primary/[0.14]",
                    today &&
                      !isSelected &&
                      "ring-2 ring-sky-500/70 ring-offset-1 ring-offset-background dark:ring-sky-400/65 font-semibold",
                    today && isSelected && "font-semibold",
                    isSelected && "ring-2 ring-primary ring-offset-1 ring-offset-background",
                  )}
                >
                  <span className="relative z-[1] tabular-nums leading-none">{format(day, "d")}</span>
                  {hasSession && userDined && (
                    <span
                      className="absolute bottom-0.5 right-0.5 block h-1 w-1 rounded-full bg-orange-500 dark:bg-orange-400 shadow-sm sm:h-1.5 sm:w-1.5"
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
        <p className="text-xs text-muted-foreground">{t("signInToSeeShare")}</p>
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

  return (
    <Card
      className={cn(
        "overflow-hidden border-[var(--color-hist-play-border)]/40 bg-[var(--color-hist-play-bg)]/30",
      )}
    >
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold capitalize text-[var(--color-hist-play-fg)]">
                {formatDateLabel(session.date, dateLocale)}
              </span>
              <Badge variant={isCompleted ? "secondary" : "destructive"} className="text-[10px]">
                {isCompleted ? t("completed") : t("cancelled")}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{session.courtName}</p>
          </div>
        </div>

        {isIdentified && my && currentMemberId != null && (
          <div
            className="rounded-lg border border-[var(--color-hist-play-border)]/50 bg-background/60 dark:bg-background/40 p-3 flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground leading-none">
              {t("yourShare")}
            </p>
            <div className="flex min-w-0 w-full flex-wrap items-center gap-x-2 gap-y-1">
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
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-left w-full">
                <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
                  <span className="text-muted-foreground">{t("playCost")}:</span>
                  <strong className="tabular-nums text-sm text-[var(--color-hist-play-fg)]">
                    {formatK(my.playShare)}
                  </strong>
                </span>
                <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
                  <span className="text-muted-foreground">{t("dineCost")}:</span>
                  <strong className="tabular-nums text-sm text-[var(--color-hist-dine-fg)]">
                    {formatK(my.dineShare)}
                  </strong>
                </span>
                <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
                  <span className="text-muted-foreground">{t("totalShort")}:</span>
                  <strong
                    className={cn(
                      "tabular-nums font-semibold text-sm",
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
            <h4 className="text-[10px] font-semibold uppercase text-muted-foreground">
              {t("costBreakdown")}
              <span className="tabular-nums text-primary pl-2 text-sm">{formatK(session.totalCost)}</span>
            </h4>
          )}
          <div className="grid gap-2 sm:grid-cols-2 items-stretch">
            <div
              className={cn(
                "rounded-lg border px-3 py-2 text-sm flex flex-col gap-2 h-full min-h-0",
                "border-[var(--color-hist-play-border)] bg-[var(--color-hist-play-bg)]",
              )}
            >
              {isCompleted && (
                <div className="space-y-1">
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground text-xs">{t("court")}</span>
                    <span className="tabular-nums text-[var(--color-hist-play-fg)]">
                      {formatK(session.courtPrice)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground text-xs">{t("shuttlecock")}</span>
                    <span className="tabular-nums text-[var(--color-hist-play-fg)]">
                      {formatK(session.shuttlecockCost)}
                    </span>
                  </div>
                </div>
              )}
              <div
                className={cn(
                  "mt-auto flex min-h-10 items-baseline gap-2 text-xs font-medium text-[var(--color-hist-play-fg)]",
                  isCompleted && "border-t border-[var(--color-hist-play-border)]/35 pt-2",
                )}
              >
                <span
                  className="text-base leading-none shrink-0 opacity-90 select-none"
                  aria-hidden
                >
                  🏸
                </span>
                <span>
                  {t("play")}{" "}
                  <strong className="tabular-nums text-base leading-none">{session.playerCount}</strong>
                </span>
              </div>
            </div>
            <div
              className={cn(
                "rounded-lg border px-3 py-2 text-sm flex flex-col gap-2 h-full min-h-0",
                "border-[var(--color-hist-dine-border)] bg-[var(--color-hist-dine-bg)]",
              )}
            >
              {isCompleted && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground text-xs">{t("dining")}</span>
                  <span className="tabular-nums text-[var(--color-hist-dine-fg)]">
                    {formatK(session.diningBill)}
                  </span>
                </div>
              )}
              <div
                className={cn(
                  "mt-auto flex min-h-10 items-baseline gap-2 text-xs font-medium text-[var(--color-hist-dine-fg)]",
                  isCompleted && "border-t border-[var(--color-hist-dine-border)]/35 pt-2",
                )}
              >
                <span
                  className="text-base leading-none shrink-0 opacity-90 select-none"
                  aria-hidden
                >
                  🍻
                </span>
                <span>
                  {t("dine")}{" "}
                  <strong className="tabular-nums text-base leading-none">{session.dinerCount}</strong>
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <h4 className="text-[10px] font-semibold uppercase text-muted-foreground">
            {t("participants")}
          </h4>
          <div className="space-y-2">
            {session.attendees.map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-sm">
                {a.memberId ? (
                  <MemberAvatar memberId={a.memberId} avatarKey={a.memberAvatarKey} avatarUrl={a.memberAvatarUrl} size={24} />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px]">
                    K
                  </div>
                )}
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    a.isGuest && "italic text-muted-foreground",
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
          <p className="text-sm text-muted-foreground border-t border-border/60 pt-3">
            {t("sessionCancelled")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

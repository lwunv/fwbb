"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  getMemberPlayHistory,
  type MemberPlayHistoryEntry,
} from "@/actions/member-history";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TabSegment } from "@/components/shared/tab-segment";
import { useIsMobile } from "@/lib/use-is-mobile";
import { cn, formatK } from "@/lib/utils";
import { formatSessionDate } from "@/lib/date-format";
import type { AppLocale } from "@/lib/date-fns-locale";
import type { PaidStatus } from "@/lib/fifo-paid-attribution";

type ViewMode = "calendar" | "list";
const LIST_PAGE_SIZE = 10;

const STATUS_CLASS: Record<PaidStatus, string> = {
  paid: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  partial: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  unpaid: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
};

/**
 * Overlay lịch sử chơi của 1 member (admin xem). Tự fetch theo memberId nên
 * dùng chung được ở /admin/members và /admin/fund — trang chỉ cần giữ state
 * member đang xem và render component này.
 */
export function MemberPlayHistorySheet({
  memberId,
  memberName,
  onClose,
}: {
  /** null = đóng */
  memberId: number | null;
  memberName: string;
  onClose: () => void;
}) {
  const t = useTranslations("memberHistory");
  const locale = useLocale() as AppLocale;
  const isMobile = useIsMobile();
  const [view, setView] = useState<ViewMode>("list");

  const open = memberId !== null;
  const { data, isPending, isError } = useQuery({
    queryKey: ["member-play-history", memberId],
    queryFn: () => getMemberPlayHistory(memberId!),
    enabled: open,
  });

  const history = data && !("error" in data) ? data : null;

  const body = (
    <div className="space-y-4">
      <BalanceLine balance={history?.balance} loading={isPending} />
      <TabSegment<ViewMode>
        ariaLabel={t("title")}
        variant="rounded"
        options={[
          { value: "calendar", label: t("tabCalendar") },
          { value: "list", label: t("tabList") },
        ]}
        value={view}
        onChange={setView}
      />
      {isPending ? (
        <HistorySkeleton />
      ) : isError || (data && "error" in data) ? (
        <p className="text-destructive py-8 text-center text-sm">
          {t("loadError")}
        </p>
      ) : history && history.entries.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10">
          <span className="text-3xl">🏸</span>
          <p className="text-muted-foreground text-sm">{t("empty")}</p>
        </div>
      ) : history ? (
        <HistoryList entries={history.entries} locale={locale} />
      ) : null}
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {t("title")} · {memberName}
            </SheetTitle>
          </SheetHeader>
          {body}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t("title")} · {memberName}
          </DialogTitle>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}

function BalanceLine({
  balance,
  loading,
}: {
  balance: number | undefined;
  loading: boolean;
}) {
  const t = useTranslations("memberHistory");
  if (loading || balance === undefined) {
    return <div className="bg-muted h-5 w-32 animate-pulse rounded" />;
  }
  if (balance < 0) {
    return (
      <p className="text-sm font-semibold text-rose-600 dark:text-rose-400">
        {t("owingLine", { amount: formatK(-balance) })}
      </p>
    );
  }
  if (balance === 0) {
    return <p className="text-muted-foreground text-sm">{t("zeroLine")}</p>;
  }
  return (
    <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
      {t("fundLine", { amount: formatK(balance) })}
    </p>
  );
}

function HistorySkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="bg-muted h-14 animate-pulse rounded-xl" />
      ))}
    </div>
  );
}

function StatusBadgeFor({ status }: { status: PaidStatus }) {
  const t = useTranslations("memberHistory");
  const label =
    status === "paid"
      ? t("statusPaid")
      : status === "partial"
        ? t("statusPartial")
        : t("statusUnpaid");
  return (
    <Badge variant="outline" className={cn("border-0", STATUS_CLASS[status])}>
      {label}
    </Badge>
  );
}

function EntryDetail({
  entry,
  locale,
}: {
  entry: MemberPlayHistoryEntry;
  locale: AppLocale;
}) {
  const t = useTranslations("memberHistory");
  const rows: Array<[string, string]> = [
    [t("detailTime"), `${entry.startTime} - ${entry.endTime}`],
    [t("detailCourt"), entry.courtName ?? "-"],
    [t("detailTotal"), `${formatK(entry.totalAmount)}đ`],
  ];
  if (entry.playAmount > 0)
    rows.push([t("detailPlay"), `${formatK(entry.playAmount)}đ`]);
  if (entry.dineAmount > 0)
    rows.push([t("detailDine"), `${formatK(entry.dineAmount)}đ`]);
  return (
    <div className="text-muted-foreground space-y-1 pt-2 text-sm">
      <p className="text-foreground font-medium">
        {formatSessionDate(entry.date, "weekdayLong", locale)}
      </p>
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4">
          <span>{k}</span>
          <span className="text-foreground font-medium">{v}</span>
        </div>
      ))}
    </div>
  );
}

function HistoryList({
  entries,
  locale,
}: {
  entries: MemberPlayHistoryEntry[];
  locale: AppLocale;
}) {
  const t = useTranslations("memberHistory");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const totalPages = Math.max(1, Math.ceil(entries.length / LIST_PAGE_SIZE));
  const pageEntries = useMemo(
    () => entries.slice((page - 1) * LIST_PAGE_SIZE, page * LIST_PAGE_SIZE),
    [entries, page],
  );
  return (
    <div className="space-y-2">
      {pageEntries.map((e) => (
        <button
          key={e.sessionId}
          type="button"
          onClick={() =>
            setExpandedId(expandedId === e.sessionId ? null : e.sessionId)
          }
          className="bg-card/80 w-full rounded-xl border p-3 text-left"
        >
          <div className="flex min-h-11 items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">
                {formatSessionDate(e.date, "weekday", locale)}
              </p>
              <p className="text-muted-foreground text-sm">
                {e.startTime} - {e.endTime} · {formatK(e.totalAmount)}đ
              </p>
            </div>
            <StatusBadgeFor status={e.paidStatus} />
          </div>
          {expandedId === e.sessionId && (
            <EntryDetail entry={e} locale={locale} />
          )}
        </button>
      ))}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 min-w-11"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            aria-label={t("prevPage")}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-muted-foreground text-sm">
            {t("pageOf", { page, total: totalPages })}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 min-w-11"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            aria-label={t("nextPage")}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

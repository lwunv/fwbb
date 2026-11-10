"use client";

import { lazy, Suspense, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  CheckCheck,
  Eye,
  EyeOff,
  Flag,
  Handshake,
  MessageSquare,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import {
  adminCancelExchange,
  adminListComments,
  adminListExchanges,
  adminListReports,
  adminModerateComment,
  adminResolveReport,
  adminSetExchangeHidden,
  type AdminCommentRow,
  type AdminExchangeFilter,
  type AdminExchangeRow,
  type AdminReportRow,
} from "@/actions/exchange-admin";
import { REPORT_STATUSES, type ReportStatus } from "@/lib/exchange/constants";
import { fireAction } from "@/lib/optimistic-action";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmSheet } from "@/components/exchange/confirm-sheet";
import { EmptyState } from "@/components/shared/empty-state";
import { TabSegment } from "@/components/shared/tab-segment";
import type { ReviewFilter } from "./admin-reputation-panel";

// Tab Uy tín tải riêng khi mở: hiếm dùng, khỏi nặng trang mặc định.
const AdminReputationPanel = lazy(() =>
  import("./admin-reputation-panel").then((m) => ({
    default: m.AdminReputationPanel,
  })),
);

export type AdminExchangeTab = "events" | "reports" | "comments" | "reputation";
type Tab = AdminExchangeTab;
type CommentFilter = "held" | "hidden" | "reported";
type CommentAction = "approve" | "unhide" | "delete" | "dismiss";
const COMMENT_FILTERS: CommentFilter[] = ["held", "hidden", "reported"];
const FILTERS: AdminExchangeFilter[] = ["upcoming", "hidden", "all"];
const VN_TZ = "Asia/Ho_Chi_Minh";
const LIVE = ["open", "full", "locked"];

function formatWhen(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: VN_TZ,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function matchesFilter(r: AdminExchangeRow, f: AdminExchangeFilter) {
  if (f === "hidden") return r.hiddenAt !== null;
  if (f === "upcoming") return r.hiddenAt === null && LIVE.includes(r.status);
  return true;
}

export function AdminExchangeClient({
  initialEvents,
  initialReports,
  initialTab = "events",
}: {
  initialEvents: AdminExchangeRow[];
  initialReports: AdminReportRow[];
  /** Từ `?tab=` của trang, để link "Xem ở tab Uy tín" mở thẳng đúng tab. */
  initialTab?: Tab;
}) {
  const t = useTranslations("exchange.admin");
  const [tab, setTab] = useState<Tab>(initialTab);
  // Mục con của tab Uy tín khi mở từ một báo cáo đánh giá: "Bị báo cáo".
  const [repFilter, setRepFilter] = useState<ReviewFilter>("held");
  const [filter, setFilter] = useState<AdminExchangeFilter>("upcoming");
  const [reportStatus, setReportStatus] = useState<ReportStatus>("open");
  const qc = useQueryClient();

  // Overlay optimistic: thẻ đổi ngay khi bấm, rollback nếu action lỗi.
  const [eventPatch, setEventPatch] = useState<
    Record<number, Partial<AdminExchangeRow>>
  >({});
  const [reportPatch, setReportPatch] = useState<Record<number, ReportStatus>>(
    {},
  );
  const [commentFilter, setCommentFilter] = useState<CommentFilter>("held");
  // Bình luận đã xử lý (ẩn khỏi danh sách) hoặc đổi trạng thái, rollback khi lỗi.
  // Khoá `${bộ lọc}:${id}`: cùng một bình luận có thể nằm ở nhiều tab con
  // (Bị báo cáo gồm cả bình luận tự ẩn), xử lý ở tab này không được làm nó mất ở tab kia.
  const [commentPatch, setCommentPatch] = useState<
    Record<string, Partial<AdminCommentRow> | "removed">
  >({});
  // Mốc dataUpdatedAt lúc server nhận xử lý; dữ liệu mới hơn mốc này thay patch.
  const [commentSettled, setCommentSettled] = useState<Record<string, number>>(
    {},
  );
  const [confirmDeleteRow, setConfirmDeleteRow] =
    useState<AdminCommentRow | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<number | null>(null);

  // staleTime 60s, không tự làm mới theo giờ (quota Turso).
  const events = useQuery({
    queryKey: ["admin-exchange-events", filter],
    queryFn: async () => {
      const r = await adminListExchanges(filter);
      if ("error" in r) throw new Error(r.error);
      return r.data;
    },
    initialData: filter === "upcoming" ? initialEvents : undefined,
    staleTime: 60_000,
  });
  const reports = useQuery({
    queryKey: ["admin-exchange-reports", reportStatus],
    queryFn: async () => {
      const r = await adminListReports(reportStatus);
      if ("error" in r) throw new Error(r.error);
      return r.data;
    },
    initialData: reportStatus === "open" ? initialReports : undefined,
    staleTime: 60_000,
  });

  // Chỉ tải khi mở tab Bình luận, không tự làm mới (quota Turso).
  const comments = useQuery({
    queryKey: ["admin-exchange-comments", commentFilter],
    queryFn: async () => {
      const r = await adminListComments(commentFilter);
      if ("error" in r) throw new Error(r.error);
      return r.data;
    },
    enabled: tab === "comments",
    staleTime: 60_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-exchange-events"] });
    qc.invalidateQueries({ queryKey: ["admin-exchange-reports"] });
  };

  function patchEvent(id: number, patch: Partial<AdminExchangeRow>) {
    const prev = eventPatch[id];
    setEventPatch((m) => ({ ...m, [id]: { ...m[id], ...patch } }));
    return () =>
      setEventPatch((m) => {
        const n = { ...m };
        if (prev === undefined) delete n[id];
        else n[id] = prev;
        return n;
      });
  }

  function setHidden(row: AdminExchangeRow, hidden: boolean) {
    const rollback = patchEvent(row.id, {
      hiddenAt: hidden ? new Date().toISOString() : null,
    });
    fireAction(
      () => adminSetExchangeHidden({ eventId: row.id, hidden }),
      rollback,
      {
        successMsg: hidden ? t("hiddenToast") : t("shownToast"),
        onSuccess: invalidate,
      },
    );
  }

  function cancelEvent(row: AdminExchangeRow) {
    setConfirmCancelId(null);
    const rollback = patchEvent(row.id, { status: "cancelled" });
    // Huỷ không idempotent ở phía người dùng (lần hai báo lỗi), nên không retry.
    fireAction(() => adminCancelExchange({ eventId: row.id }), rollback, {
      retry: false,
      successMsg: t("cancelledToast"),
      onSuccess: invalidate,
    });
  }

  function moderate(row: AdminCommentRow, action: CommentAction) {
    const pk = `${commentFilter}:${row.id}`;
    const prev = commentPatch[pk];
    // Duyệt ở tab "Bị báo cáo" chỉ đổi trạng thái; còn lại bình luận rời danh sách.
    const next: Partial<AdminCommentRow> | "removed" =
      action === "approve" && commentFilter === "reported"
        ? { status: "visible" }
        : "removed";
    // Xử lý lại cùng dòng: mốc "đã về" của lần trước không được che patch mới.
    setCommentSettled((m) => {
      const n = { ...m };
      delete n[pk];
      return n;
    });
    setCommentPatch((m) => ({ ...m, [pk]: next }));
    fireAction(
      () => adminModerateComment({ commentId: row.id, action }),
      () =>
        setCommentPatch((m) => {
          const n = { ...m };
          if (prev === undefined) delete n[pk];
          else n[pk] = prev;
          return n;
        }),
      {
        retry: false,
        successMsg: {
          approve: t("commentApprovedToast"),
          unhide: t("commentUnhiddenToast"),
          dismiss: t("commentDismissedToast"),
          delete: t("commentDeletedToast"),
        }[action],
        // Patch chỉ bỏ khi danh sách mới đã về (xem `commentRows`): bỏ ngay sau
        // `await invalidate` thì react-query chưa kịp báo, một khung hình thấy dòng cũ.
        onSuccess: () => {
          const at =
            qc.getQueryState(["admin-exchange-comments", commentFilter])
              ?.dataUpdatedAt ?? 0;
          setCommentSettled((m) => ({ ...m, [pk]: at }));
          void qc.invalidateQueries({ queryKey: ["admin-exchange-comments"] });
          if (action !== "approve")
            void qc.invalidateQueries({
              queryKey: ["admin-exchange-reports"],
            });
        },
      },
    );
  }

  function resolve(row: AdminReportRow, status: "resolved" | "dismissed") {
    const prev = reportPatch[row.id];
    setReportPatch((m) => ({ ...m, [row.id]: status }));
    fireAction(
      () => adminResolveReport({ reportId: row.id, status }),
      () =>
        setReportPatch((m) => {
          const n = { ...m };
          if (prev === undefined) delete n[row.id];
          else n[row.id] = prev;
          return n;
        }),
      {
        successMsg:
          status === "resolved" ? t("resolvedToast") : t("dismissedToast"),
        onSuccess: invalidate,
      },
    );
  }

  const eventRows = (events.data ?? [])
    .map((r) => ({ ...r, ...eventPatch[r.id] }))
    .filter((r) => matchesFilter(r, filter));
  const reportRows = (reports.data ?? []).filter(
    (r) => (reportPatch[r.id] ?? r.status) === reportStatus,
  );

  const commentRows = (comments.data ?? []).flatMap((r) => {
    const pk = `${commentFilter}:${r.id}`;
    const arrived =
      commentSettled[pk] !== undefined &&
      comments.dataUpdatedAt > commentSettled[pk];
    const p = arrived ? undefined : commentPatch[pk];
    if (p === "removed") return [];
    return [{ ...r, ...p }];
  });

  const confirmRow =
    confirmCancelId === null
      ? undefined
      : eventRows.find((r) => r.id === confirmCancelId);

  const filterLabel: Record<AdminExchangeFilter, string> = {
    upcoming: t("filterUpcoming"),
    hidden: t("filterHidden"),
    all: t("filterAll"),
  };
  const reportLabel: Record<ReportStatus, string> = {
    open: t("reportOpen"),
    resolved: t("reportResolved"),
    dismissed: t("reportDismissed"),
  };

  const commentLabel: Record<CommentFilter, string> = {
    held: t("commentHeld"),
    hidden: t("commentHidden"),
    reported: t("commentReported"),
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <h2 className="text-xl font-bold">{t("title")}</h2>
      <TabSegment
        variant="rounded"
        value={tab}
        onChange={setTab}
        options={[
          { value: "events", label: t("tabEvents"), icon: Handshake },
          { value: "reports", label: t("tabReports"), icon: Flag },
          { value: "comments", label: t("tabComments"), icon: MessageSquare },
          { value: "reputation", label: t("tabReputation"), icon: ShieldCheck },
        ]}
      />

      {tab === "events" ? (
        <>
          <TabSegment
            value={filter}
            onChange={setFilter}
            options={FILTERS.map((f) => ({ value: f, label: filterLabel[f] }))}
          />
          {events.isPending ? (
            <ListSkeleton />
          ) : eventRows.length === 0 ? (
            <EmptyState icon={Handshake} title={t("emptyEvents")} />
          ) : (
            <div className="grid gap-3">
              <AnimatePresence initial={false}>
                {eventRows.map((r) => (
                  <EventCard
                    key={r.id}
                    row={r}
                    onHide={(h) => setHidden(r, h)}
                    onAskCancel={() => setConfirmCancelId(r.id)}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </>
      ) : tab === "reputation" ? (
        <Suspense fallback={<ReputationPanelSkeleton />}>
          <AdminReputationPanel initialFilter={repFilter} />
        </Suspense>
      ) : tab === "comments" ? (
        <>
          <TabSegment
            value={commentFilter}
            onChange={setCommentFilter}
            options={COMMENT_FILTERS.map((f) => ({
              value: f,
              label: commentLabel[f],
            }))}
          />
          {comments.isPending ? (
            <ListSkeleton />
          ) : comments.isError ? (
            <EmptyState icon={MessageSquare} title={t("loadError")} />
          ) : commentRows.length === 0 ? (
            <EmptyState icon={MessageSquare} title={t("emptyComments")} />
          ) : (
            <div className="grid gap-3">
              <AnimatePresence initial={false}>
                {commentRows.map((r) => (
                  <CommentCard
                    key={r.id}
                    row={r}
                    onModerate={(a) =>
                      a === "delete" ? setConfirmDeleteRow(r) : moderate(r, a)
                    }
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </>
      ) : (
        <>
          <TabSegment
            value={reportStatus}
            onChange={setReportStatus}
            options={REPORT_STATUSES.map((s) => ({
              value: s,
              label: reportLabel[s],
            }))}
          />
          {reports.isPending ? (
            <ListSkeleton />
          ) : reportRows.length === 0 ? (
            <EmptyState icon={Flag} title={t("emptyReports")} />
          ) : (
            <div className="grid gap-3">
              <AnimatePresence initial={false}>
                {reportRows.map((r) => (
                  <ReportCard
                    key={r.id}
                    row={r}
                    onResolve={(s) => resolve(r, s)}
                    onOpenReputation={() => {
                      setRepFilter("reported");
                      setTab("reputation");
                    }}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </>
      )}

      <ConfirmSheet
        open={confirmRow !== undefined}
        onOpenChange={(o) => {
          if (!o) setConfirmCancelId(null);
        }}
        title={confirmRow?.title ?? t("cancelEvent")}
        description={t("cancelConfirm")}
        confirmLabel={t("cancelYes")}
        cancelLabel={t("cancelNo")}
        onConfirm={() => {
          if (confirmRow) cancelEvent(confirmRow);
        }}
      />
      <ConfirmSheet
        open={confirmDeleteRow !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmDeleteRow(null);
        }}
        title={t("commentDelete")}
        description={t("commentDeleteConfirm")}
        confirmLabel={t("commentDelete")}
        cancelLabel={t("cancelNo")}
        onConfirm={() => {
          if (confirmDeleteRow) moderate(confirmDeleteRow, "delete");
        }}
      />
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-36 w-full rounded-xl" />
      ))}
    </div>
  );
}

/**
 * Chờ tải tab Uy tín: giữ chỗ hai hàng tab (mục, bộ lọc) như panel thật, để
 * danh sách không bị đẩy xuống khi panel hiện ra.
 */
export function ReputationPanelSkeleton() {
  return (
    <div className="space-y-3" data-testid="rep-panel-skeleton">
      <div className="flex gap-2" data-testid="rep-tabbar-skeleton">
        <Skeleton className="h-11 w-28 rounded-full" />
        <Skeleton className="h-11 w-28 rounded-full" />
      </div>
      <div className="flex gap-2" data-testid="rep-tabbar-skeleton">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-11 w-24 rounded-full" />
        ))}
      </div>
      <ListSkeleton />
    </div>
  );
}

function EventCard({
  row,
  onHide,
  onAskCancel,
}: {
  row: AdminExchangeRow;
  onHide: (hidden: boolean) => void;
  onAskCancel: () => void;
}) {
  const t = useTranslations("exchange.admin");
  const tStatus = useTranslations("exchange.event");
  const locale = useLocale();
  const statusLabel = {
    open: tStatus("statusOpen"),
    full: tStatus("statusFull"),
    locked: tStatus("statusLocked"),
    done: tStatus("statusDone"),
    cancelled: tStatus("statusCancelled"),
  }[row.status as "open" | "full" | "locked" | "done" | "cancelled"];
  const cancellable = LIVE.includes(row.status);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className="border-border bg-card/80 space-y-3 rounded-xl border p-4 backdrop-blur"
    >
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/exchanges/${row.publicCode}`}
            className="min-w-0 truncate text-base font-semibold hover:underline"
          >
            {row.title}
          </Link>
          <span className="bg-muted rounded-full px-2 py-0.5 text-sm">
            {statusLabel}
          </span>
          {row.hiddenAt && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-sm text-amber-700 dark:text-amber-300">
              {tStatus("hiddenBadge")}
            </span>
          )}
        </div>
        <p className="text-muted-foreground text-sm">
          {formatWhen(row.startAt, locale)}
        </p>
        <p className="text-muted-foreground text-sm">
          {t("host")}: {row.hostName} · {t("venue")}: {row.venueName}
        </p>
        <p className="text-muted-foreground text-sm">
          {t("slots", { held: row.holdingHeads, total: row.slotsTotal })}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          className="min-h-11"
          onClick={() => onHide(row.hiddenAt === null)}
        >
          {row.hiddenAt ? (
            <Eye className="mr-1.5 h-4 w-4" />
          ) : (
            <EyeOff className="mr-1.5 h-4 w-4" />
          )}
          {row.hiddenAt ? t("unhide") : t("hide")}
        </Button>
        {cancellable && (
          <Button
            variant="outline"
            className={cn("text-destructive min-h-11")}
            onClick={onAskCancel}
          >
            <X className="mr-1.5 h-4 w-4" />
            {t("cancelEvent")}
          </Button>
        )}
      </div>
    </motion.div>
  );
}

function ReportCard({
  row,
  onResolve,
  onOpenReputation,
}: {
  row: AdminReportRow;
  onResolve: (status: "resolved" | "dismissed") => void;
  onOpenReputation: () => void;
}) {
  const t = useTranslations("exchange.admin");
  const tReason = useTranslations("notifications.reportReasons");
  const locale = useLocale();

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className="border-border bg-card/80 space-y-3 rounded-xl border p-4 backdrop-blur"
    >
      <div className="space-y-1">
        <p className="text-base font-semibold">{tReason(row.reason)}</p>
        <p className="text-sm break-words">
          {row.targetType === "event"
            ? t("targetEvent")
            : row.targetType === "comment"
              ? t("targetComment")
              : row.targetType === "review"
                ? t("targetReview")
                : row.targetType === "venue"
                  ? t("targetVenue")
                  : t("targetMember")}
          {": "}
          {row.venueId !== null &&
          (row.targetType === "review" || row.targetType === "venue") ? (
            <Link
              href={`/venues/${row.venueId}`}
              className="underline underline-offset-2"
            >
              {row.targetName}
            </Link>
          ) : row.eventCode ? (
            <Link
              href={`/exchanges/${row.eventCode}${row.targetType === "comment" ? "#comments" : ""}`}
              className="underline underline-offset-2"
            >
              {row.targetName}
            </Link>
          ) : (
            row.targetName
          )}
        </p>
        {row.commentExcerpt !== null && (
          <p className="bg-muted rounded-lg px-3 py-2 text-base break-words whitespace-pre-wrap">
            {row.commentExcerpt}
          </p>
        )}
        {row.reviewExcerpt !== null && (
          <p className="bg-muted rounded-lg px-3 py-2 text-base break-words whitespace-pre-wrap">
            {row.reviewExcerpt}
          </p>
        )}
        {row.targetType === "review" && (
          <Link
            href="/admin/exchanges?tab=reputation"
            onClick={(e) => {
              // Đổi tab tại chỗ, không tải lại trang (khỏi đọc lại DB).
              e.preventDefault();
              onOpenReputation();
            }}
            className="text-primary inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-2"
          >
            {t("openReputation")}
          </Link>
        )}
        <p className="text-muted-foreground text-sm">
          {t("reporter")}: {row.reporterName} ·{" "}
          {formatWhen(row.createdAt, locale)}
        </p>
        <p className="text-muted-foreground text-sm break-words">
          {row.note ?? t("noNote")}
        </p>
      </div>
      {row.status === "open" && (
        <div className="flex flex-wrap gap-2">
          <Button className="min-h-11" onClick={() => onResolve("resolved")}>
            <CheckCheck className="mr-1.5 h-4 w-4" />
            {t("resolve")}
          </Button>
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => onResolve("dismissed")}
          >
            {t("dismiss")}
          </Button>
        </div>
      )}
    </motion.div>
  );
}

function CommentCard({
  row,
  onModerate,
}: {
  row: AdminCommentRow;
  onModerate: (action: CommentAction) => void;
}) {
  const t = useTranslations("exchange.admin");
  const locale = useLocale();

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className="border-border bg-card/80 space-y-3 rounded-xl border p-4 backdrop-blur"
    >
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/exchanges/${row.eventCode}#comments`}
            className="min-w-0 truncate text-base font-semibold hover:underline"
          >
            {row.eventTitle}
          </Link>
          <span className="bg-muted rounded-full px-2 py-0.5 text-sm">
            {row.channel === "group" ? t("channelGroup") : t("channelQa")}
          </span>
          {row.openReports > 0 && (
            <span className="bg-destructive/10 text-destructive rounded-full px-2 py-0.5 text-sm">
              {t("commentReports", { count: row.openReports })}
            </span>
          )}
        </div>
        <p className="text-sm">
          <span className="font-medium">{row.authorName}</span>
          {row.authorIsHost && (
            <span className="bg-primary/10 text-primary ml-2 rounded-full px-2 py-0.5">
              {t("commentHostBadge")}
            </span>
          )}
          <span className="text-muted-foreground">
            {" · "}
            {formatWhen(row.createdAt, locale)}
          </span>
        </p>
        <p className="text-base break-words whitespace-pre-wrap">{row.body}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {row.status === "held" && (
          <Button className="min-h-11" onClick={() => onModerate("approve")}>
            <CheckCheck className="mr-1.5 h-4 w-4" />
            {t("commentApprove")}
          </Button>
        )}
        {row.status === "hidden" && (
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => onModerate("unhide")}
          >
            <Eye className="mr-1.5 h-4 w-4" />
            {t("commentUnhide")}
          </Button>
        )}
        {row.openReports > 0 && (
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => onModerate("dismiss")}
          >
            {t("commentDismiss")}
          </Button>
        )}
        {row.status !== "deleted" && (
          <Button
            variant="outline"
            className="text-destructive min-h-11"
            onClick={() => onModerate("delete")}
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            {t("commentDelete")}
          </Button>
        )}
      </div>
    </motion.div>
  );
}

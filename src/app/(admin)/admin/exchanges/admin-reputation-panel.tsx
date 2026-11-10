"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCheck,
  Eye,
  EyeOff,
  Flag,
  MessageSquareText,
  Star,
} from "lucide-react";
import {
  adminListHostFlags,
  adminListVenueReviews,
  adminModerateVenueReview,
  adminReviewHostFlag,
  type AdminHostFlagRow,
  type AdminVenueReviewRow,
} from "@/actions/reputation-admin";
import {
  VENUE_CRITERIA,
  type ReviewHoldReason,
  type VenueCriterion,
} from "@/lib/reputation/constants";
import { fireAction } from "@/lib/optimistic-action";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmSheet } from "@/components/exchange/confirm-sheet";
import { EmptyState } from "@/components/shared/empty-state";
import { TabSegment } from "@/components/shared/tab-segment";

export type ReviewFilter = "held" | "hidden" | "reported";
type ReviewAction = "approve" | "unhide" | "hide" | "dismiss";
type Section = "reviews" | "flags";

const REVIEW_FILTERS: ReviewFilter[] = ["held", "hidden", "reported"];
const VN_TZ = "Asia/Ho_Chi_Minh";
const CARD =
  "border-border bg-card/80 space-y-3 rounded-xl border p-4 backdrop-blur";

function formatWhen(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: VN_TZ,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

/**
 * Tab Uy tín của trang admin giao lưu: duyệt đánh giá sân và xem cờ host.
 * Mọi danh sách chỉ tải khi mở đúng mục và không tự làm mới (quota Turso).
 */
export function AdminReputationPanel({
  initialFilter = "held",
}: {
  initialFilter?: ReviewFilter;
}) {
  const t = useTranslations("exchange.admin");
  const [section, setSection] = useState<Section>("reviews");

  return (
    <div className="space-y-3">
      <TabSegment
        value={section}
        onChange={setSection}
        options={[
          { value: "reviews", label: t("repReviews"), icon: Star },
          { value: "flags", label: t("repHostFlags"), icon: AlertTriangle },
        ]}
      />
      {section === "reviews" ? (
        <ReviewsSection initialFilter={initialFilter} />
      ) : (
        <HostFlagsSection />
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-48 w-full rounded-xl" />
      ))}
    </div>
  );
}

function ReviewsSection({ initialFilter }: { initialFilter: ReviewFilter }) {
  const t = useTranslations("exchange.admin");
  const qc = useQueryClient();
  const [filter, setFilter] = useState<ReviewFilter>(initialFilter);
  // Khoá `${bộ lọc}:${id}`: cùng một đánh giá có thể nằm ở "Chờ duyệt" và
  // "Bị báo cáo"; xử lý ở mục này không được làm nó biến mất ở mục kia.
  const [patch, setPatch] = useState<
    Record<string, Partial<AdminVenueReviewRow> | "removed">
  >({});
  // Mốc dataUpdatedAt lúc server nhận xử lý; dữ liệu mới hơn mốc này thay patch.
  const [settled, setSettled] = useState<Record<string, number>>({});
  const [confirmHide, setConfirmHide] = useState<AdminVenueReviewRow | null>(
    null,
  );

  const reviews = useQuery({
    queryKey: ["admin-venue-reviews", filter],
    queryFn: async () => {
      const r = await adminListVenueReviews(filter);
      if ("error" in r) throw new Error(r.error);
      return r.data;
    },
    staleTime: 60_000,
  });

  function nextPatch(
    action: ReviewAction,
  ): Partial<AdminVenueReviewRow> | "removed" {
    // Ở "Bị báo cáo", duyệt không đụng báo cáo nên dòng ở lại với trạng thái mới.
    if (action === "approve")
      return filter === "reported"
        ? { status: "visible", holdReason: null }
        : "removed";
    // Bỏ qua báo cáo giữ nguyên trạng thái: chỉ rời mục "Bị báo cáo".
    if (action === "dismiss")
      return filter === "reported"
        ? "removed"
        : { openReports: 0, reportCount: 0 };
    return "removed";
  }

  function moderate(row: AdminVenueReviewRow, action: ReviewAction) {
    const pk = `${filter}:${row.id}`;
    const prev = patch[pk];
    const f = filter;
    setSettled((m) => {
      const n = { ...m };
      delete n[pk];
      return n;
    });
    setPatch((m) => ({ ...m, [pk]: nextPatch(action) }));
    fireAction(
      () => adminModerateVenueReview({ reviewId: row.id, action }),
      () =>
        setPatch((m) => {
          const n = { ...m };
          if (prev === undefined) delete n[pk];
          else n[pk] = prev;
          return n;
        }),
      {
        // Bấm lại sau khi đã xử lý trả lỗi "không tìm thấy", nên không retry.
        retry: false,
        successMsg: {
          approve: t("reviewApprovedToast"),
          unhide: t("reviewUnhiddenToast"),
          hide: t("reviewHiddenToast"),
          dismiss: t("reviewDismissedToast"),
        }[action],
        onSuccess: () => {
          const at =
            qc.getQueryState(["admin-venue-reviews", f])?.dataUpdatedAt ?? 0;
          setSettled((m) => ({ ...m, [pk]: at }));
          void qc.invalidateQueries({ queryKey: ["admin-venue-reviews"] });
          if (action !== "approve")
            void qc.invalidateQueries({
              queryKey: ["admin-exchange-reports"],
            });
        },
      },
    );
  }

  const rows = (reviews.data ?? []).flatMap((r) => {
    const pk = `${filter}:${r.id}`;
    const arrived =
      settled[pk] !== undefined && reviews.dataUpdatedAt > settled[pk];
    const p = arrived ? undefined : patch[pk];
    if (p === "removed") return [];
    return [{ ...r, ...p }];
  });

  const filterLabel: Record<ReviewFilter, string> = {
    held: t("reviewFilterHeld"),
    hidden: t("reviewFilterHidden"),
    reported: t("reviewFilterReported"),
  };

  return (
    <>
      <TabSegment
        value={filter}
        onChange={setFilter}
        options={REVIEW_FILTERS.map((f) => ({
          value: f,
          label: filterLabel[f],
        }))}
      />
      {reviews.isPending ? (
        <ListSkeleton />
      ) : reviews.isError ? (
        <EmptyState icon={Star} title={t("loadError")} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Star} title={t("emptyReviews")} />
      ) : (
        <div className="grid gap-3">
          <AnimatePresence initial={false}>
            {rows.map((r) => (
              <ReviewCard
                key={r.id}
                row={r}
                onModerate={(a) =>
                  a === "hide" ? setConfirmHide(r) : moderate(r, a)
                }
              />
            ))}
          </AnimatePresence>
        </div>
      )}
      <ConfirmSheet
        open={confirmHide !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmHide(null);
        }}
        title={t("reviewHideTitle")}
        description={t("reviewHideConfirm")}
        confirmLabel={t("reviewHideYes")}
        cancelLabel={t("cancelNo")}
        onConfirm={() => {
          if (confirmHide) moderate(confirmHide, "hide");
        }}
      />
    </>
  );
}

const CRITERION_KEY: Record<VenueCriterion, string> = {
  surface: "reviewCriterionSurface",
  lighting: "reviewCriterionLighting",
  ventilation: "reviewCriterionVentilation",
  price: "reviewCriterionPrice",
  parking: "reviewCriterionParking",
  owner: "reviewCriterionOwner",
};
const HOLD_KEY: Record<ReviewHoldReason, string> = {
  contact: "reviewHoldContact",
  banned: "reviewHoldBanned",
  anomaly: "reviewHoldAnomaly",
};

function ReviewCard({
  row,
  onModerate,
}: {
  row: AdminVenueReviewRow;
  onModerate: (action: ReviewAction) => void;
}) {
  const t = useTranslations("exchange.admin");
  const locale = useLocale();

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className={CARD}
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/venues/${row.venueId}`}
            className="inline-flex min-h-11 min-w-0 items-center text-base font-semibold break-words hover:underline"
          >
            {row.venueName}
          </Link>
          {row.openReports > 0 && (
            <span className="bg-destructive/10 text-destructive rounded-full px-2 py-0.5 text-sm">
              {t("commentReports", { count: row.openReports })}
            </span>
          )}
        </div>
        <p className="text-sm break-words">
          <span className="text-muted-foreground">{t("reviewAuthor")}: </span>
          <span className="font-medium">{row.authorName}</span>
          <span className="text-muted-foreground">
            {" · "}
            {formatWhen(row.createdAt, locale)}
          </span>
        </p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
          {VENUE_CRITERIA.map((c) => (
            <div key={c} className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground text-sm">
                {t(CRITERION_KEY[c])}
              </dt>
              <dd className="text-sm font-semibold tabular-nums">
                {row.scores[c]}/5
              </dd>
            </div>
          ))}
        </dl>
        {row.status === "held" && row.holdReason && (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            {t("reviewHoldReason", { reason: t(HOLD_KEY[row.holdReason]) })}
          </p>
        )}
        {/* Nhận xét đầy đủ, chữ thuần: giữ vì "anomaly" vẫn có thể chứa sđt hay link. */}
        {row.comment ? (
          <p className="bg-muted rounded-lg px-3 py-2 text-base break-words whitespace-pre-wrap">
            {row.comment}
          </p>
        ) : (
          <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
            <MessageSquareText className="h-4 w-4" />
            {t("reviewNoComment")}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {row.status === "held" && (
          <Button className="min-h-11" onClick={() => onModerate("approve")}>
            <CheckCheck className="mr-1.5 h-4 w-4" />
            {t("reviewApprove")}
          </Button>
        )}
        {row.status === "hidden" && (
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => onModerate("unhide")}
          >
            <Eye className="mr-1.5 h-4 w-4" />
            {t("reviewUnhide")}
          </Button>
        )}
        {row.status !== "hidden" && (
          <Button
            variant="outline"
            className="text-destructive min-h-11"
            onClick={() => onModerate("hide")}
          >
            <EyeOff className="mr-1.5 h-4 w-4" />
            {t("reviewHide")}
          </Button>
        )}
        {row.openReports > 0 && (
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => onModerate("dismiss")}
          >
            <Flag className="mr-1.5 h-4 w-4" />
            {t("reviewDismiss")}
          </Button>
        )}
      </div>
    </motion.div>
  );
}

function HostFlagsSection() {
  const t = useTranslations("exchange.admin");
  const qc = useQueryClient();
  const [seen, setSeen] = useState<Record<number, true>>({});
  const [settled, setSettled] = useState<Record<number, number>>({});

  const flags = useQuery({
    queryKey: ["admin-host-flags"],
    queryFn: async () => {
      const r = await adminListHostFlags();
      if ("error" in r) throw new Error(r.error);
      return r.data;
    },
    staleTime: 60_000,
  });

  function markSeen(row: AdminHostFlagRow) {
    const id = row.hostMemberId;
    setSettled((m) => {
      const n = { ...m };
      delete n[id];
      return n;
    });
    setSeen((m) => ({ ...m, [id]: true }));
    // Chỉ gửi id: server tự đếm lại số khách quen, không tin số của client.
    fireAction(
      () => adminReviewHostFlag({ hostMemberId: id }),
      () =>
        setSeen((m) => {
          const n = { ...m };
          delete n[id];
          return n;
        }),
      {
        successMsg: t("flagSeenToast"),
        onSuccess: () => {
          const at = qc.getQueryState(["admin-host-flags"])?.dataUpdatedAt ?? 0;
          setSettled((m) => ({ ...m, [id]: at }));
          void qc.invalidateQueries({ queryKey: ["admin-host-flags"] });
        },
      },
    );
  }

  const rows = (flags.data?.rows ?? []).filter((r) => {
    const id = r.hostMemberId;
    const arrived =
      settled[id] !== undefined && flags.dataUpdatedAt > settled[id];
    return arrived || !seen[id];
  });

  return (
    <>
      <p className="text-muted-foreground text-sm">{t("flagsHint")}</p>
      {flags.data?.truncated && (
        <p className="rounded-lg bg-amber-500/15 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          {t("flagsTruncated")}
        </p>
      )}
      {flags.isPending ? (
        <ListSkeleton />
      ) : flags.isError ? (
        <EmptyState icon={AlertTriangle} title={t("loadError")} />
      ) : rows.length === 0 ? (
        <EmptyState icon={AlertTriangle} title={t("emptyFlags")} />
      ) : (
        <div className="grid gap-3">
          <AnimatePresence initial={false}>
            {rows.map((r) => (
              <motion.div
                key={r.hostMemberId}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                className={CARD}
              >
                <div className="space-y-1">
                  {r.hostCode ? (
                    <Link
                      href={`/players/${r.hostCode}`}
                      className="inline-flex min-h-11 items-center text-base font-semibold break-words hover:underline"
                    >
                      {r.hostName}
                    </Link>
                  ) : (
                    <p className="text-base font-semibold break-words">
                      {r.hostName}
                    </p>
                  )}
                  <p className="text-sm">
                    {t("flagCaptives", { count: r.captives })} ·{" "}
                    {t("flagEvents", { count: r.events })}
                  </p>
                  {r.reviewedCaptives !== null && (
                    <p className="text-muted-foreground text-sm">
                      {t("flagReviewedBefore", { count: r.reviewedCaptives })}
                    </p>
                  )}
                </div>
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={() => markSeen(r)}
                >
                  <CheckCheck className="mr-1.5 h-4 w-4" />
                  {t("flagSeen")}
                </Button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </>
  );
}

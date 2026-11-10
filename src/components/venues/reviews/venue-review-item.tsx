"use client";

import { useTranslations } from "next-intl";
import { BadgeCheck, Flag, Loader2 } from "lucide-react";
import { VENUE_CRITERIA } from "@/lib/reputation/constants";
import type { VenueReviewView } from "@/lib/reputation/venue-review-read";
import { cn } from "@/lib/utils";

/**
 * Một đánh giá sân công khai. Không tên, không mã, chỉ chip "Đã chơi ở đây" và
 * tháng server đã tính (`YYYY-MM`), không bao giờ có ngày hay giờ. Nhận xét là
 * text node thuần: không linkify, không HTML.
 */
export function VenueReviewItem({
  review,
  signedIn,
  onReport,
  pending = false,
}: {
  review: VenueReviewView;
  signedIn: boolean;
  onReport?: (reviewId: number) => void;
  /** Dòng của chính mình đang gửi (optimistic): nhãn "Đang gửi…", không báo cáo. */
  pending?: boolean;
}) {
  const t = useTranslations("venueReviews");
  const [year, month] = review.month.split("-");
  return (
    <article
      aria-busy={pending || undefined}
      className={cn(
        "bg-card/80 space-y-3 rounded-2xl border p-4 shadow-sm backdrop-blur",
        pending && "border-primary/40 opacity-80",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="bg-primary/10 text-primary inline-flex min-h-7 items-center gap-1 rounded-full px-2.5 text-sm font-semibold">
          <BadgeCheck className="size-4 shrink-0" aria-hidden />
          {t("playedHere")}
        </span>
        {/* Chuỗi để ICU không tách nghìn năm ("2.026"). */}
        <time dateTime={review.month} className="text-muted-foreground text-sm">
          {t("month", { month: String(Number(month)), year: String(year) })}
        </time>
        {review.edited && (
          <span className="text-muted-foreground text-sm">{t("edited")}</span>
        )}
        {pending && (
          <span className="text-primary inline-flex items-center gap-1 text-sm font-medium">
            <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
            {t("sending")}
          </span>
        )}
      </div>

      <ul
        aria-label={t("criteriaAria")}
        className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3"
      >
        {VENUE_CRITERIA.map((c) => (
          <li
            key={c}
            className="flex min-w-0 items-center justify-between gap-2 text-sm"
          >
            <span className="text-muted-foreground min-w-0 break-words">
              {t(`criteria.${c}`)}
            </span>
            <span className="font-semibold tabular-nums">
              {review.scores[c]}
            </span>
          </li>
        ))}
      </ul>

      {review.comment && (
        <p className="text-base break-words whitespace-pre-wrap">
          {review.comment}
        </p>
      )}

      {signedIn && onReport && !pending && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => onReport(review.id)}
            className="text-muted-foreground hover:text-foreground hover:bg-accent inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-medium transition-colors active:scale-95"
          >
            <Flag className="size-4 shrink-0" aria-hidden />
            {t("report")}
          </button>
        </div>
      )}
    </article>
  );
}

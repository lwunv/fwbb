"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Flag } from "lucide-react";
import {
  ReportSheet,
  type ReportSheetTarget,
} from "@/components/exchange/report-sheet";
import type { VenueScore } from "@/lib/reputation/score";
import type { VenueReviewPage } from "@/lib/reputation/venue-review-read";
import { VenueReviewList } from "./venue-review-list";
import { VenueScoreSummary } from "./venue-score-summary";

/** Khu này chỉ báo cáo sân hoặc một đánh giá của sân. */
type Target = Extract<ReportSheetTarget, { type: "venue" | "review" }>;

/**
 * Ruột khối `data-section="venue-reviews"` khi cờ giao lưu bật (chỉ đọc).
 * Tổng điểm và trang đầu do server truyền vào; báo cáo (đánh giá hoặc thông
 * tin sân sai) chỉ cho người đã đăng nhập, dùng chung một `ReportSheet`.
 */
export function VenueReviewsSection({
  venueId,
  venueName,
  signedIn,
  summary,
  initialPage,
}: {
  venueId: number;
  venueName: string;
  signedIn: boolean;
  summary: VenueScore;
  initialPage: VenueReviewPage;
}) {
  const t = useTranslations("venueReviews");
  const [target, setTarget] = useState<Target | null>(null);
  const [open, setOpen] = useState(false);

  function report(next: Target) {
    setTarget(next);
    setOpen(true);
  }

  return (
    <div className="space-y-4">
      <VenueScoreSummary summary={summary} venueName={venueName} />
      <VenueReviewList
        venueId={venueId}
        initialPage={initialPage}
        signedIn={signedIn}
        onReport={(reviewId) => report({ type: "review", reviewId })}
      />
      {signedIn && (
        <button
          type="button"
          onClick={() => report({ type: "venue", venueId })}
          className="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center gap-1.5 rounded-xl text-base underline-offset-2 hover:underline active:scale-95"
        >
          <Flag className="size-4 shrink-0" aria-hidden />
          {t("reportVenue")}
        </button>
      )}
      {signedIn && target && (
        <ReportSheet
          // Đổi đối tượng thì làm mới phiếu (lý do, ghi chú, Turnstile).
          key={target.type === "venue" ? "venue" : `review-${target.reviewId}`}
          open={open}
          onOpenChange={setOpen}
          target={target}
        />
      )}
    </div>
  );
}

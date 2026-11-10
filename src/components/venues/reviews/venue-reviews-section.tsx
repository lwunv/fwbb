"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Flag, LogIn, PenLine } from "lucide-react";
import {
  ReportSheet,
  type ReportSheetTarget,
} from "@/components/exchange/report-sheet";
import type { VenueScore } from "@/lib/reputation/score";
import type {
  VenueReviewPage,
  VenueReviewView,
} from "@/lib/reputation/venue-review-read";
import { VenueReviewList } from "./venue-review-list";
import { VenueReviewSheet } from "./venue-review-sheet";
import { VenueScoreSummary } from "./venue-score-summary";

/** Khu này chỉ báo cáo sân hoặc một đánh giá của sân. */
type Target = Extract<ReportSheetTarget, { type: "venue" | "review" }>;

const ENTRY =
  "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold transition-transform active:scale-[0.98] sm:w-auto";

/**
 * Ruột khối `data-section="venue-reviews"` khi cờ giao lưu bật. Tổng điểm và
 * trang đầu do server truyền vào; báo cáo (đánh giá hoặc thông tin sân sai) chỉ
 * cho người đã đăng nhập, dùng chung một `ReportSheet`. Khách chỉ thấy link
 * đăng nhập quay lại sân này; người đã đăng nhập mở sheet viết đánh giá, sheet
 * hỏi server có được viết không (phần riêng chỉ tải khi mở, quota Turso).
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
  const [writeOpen, setWriteOpen] = useState(false);
  // Chỉ gắn sheet sau lần mở đầu: trang không tải gì riêng theo người khi chưa cần.
  const [writeMounted, setWriteMounted] = useState(false);
  const [pending, setPending] = useState<VenueReviewView | null>(null);

  function report(next: Target) {
    setTarget(next);
    setOpen(true);
  }

  return (
    <div className="space-y-4">
      <VenueScoreSummary summary={summary} venueName={venueName} />
      {signedIn ? (
        <button
          type="button"
          onClick={() => {
            setWriteMounted(true);
            setWriteOpen(true);
          }}
          className={`${ENTRY} bg-primary text-primary-foreground shadow-sm`}
        >
          <PenLine className="size-4 shrink-0" aria-hidden />
          {t("write")}
        </button>
      ) : (
        <Link
          href={`/exchanges/login?next=${encodeURIComponent(`/venues/${venueId}`)}`}
          className={`${ENTRY} bg-card/80 hover:bg-accent border backdrop-blur`}
        >
          <LogIn className="size-4 shrink-0" aria-hidden />
          {t("signInToReview")}
        </Link>
      )}
      <VenueReviewList
        venueId={venueId}
        initialPage={initialPage}
        signedIn={signedIn}
        onReport={(reviewId) => report({ type: "review", reviewId })}
        pendingReview={pending}
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
      {signedIn && writeMounted && (
        <VenueReviewSheet
          open={writeOpen}
          onOpenChange={setWriteOpen}
          venueId={venueId}
          onOptimistic={setPending}
        />
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

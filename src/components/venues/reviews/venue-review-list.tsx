"use client";

import { useTranslations } from "next-intl";
import { useInfiniteQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { MessageSquareText } from "lucide-react";
import { toast } from "sonner";
import { listVenueReviews } from "@/actions/venue-reviews";
import { EmptyState } from "@/components/shared/empty-state";
import type {
  VenueReviewPage,
  VenueReviewView,
} from "@/lib/reputation/venue-review-read";
import { ReviewSkeleton } from "./review-skeleton";
import { VenueReviewItem } from "./venue-review-item";

/**
 * Danh sách đánh giá, 10 dòng mỗi trang. Trang đầu do server render sẵn
 * (`initialData`), các trang sau chỉ tải khi bấm "Xem thêm". Không polling
 * (quota Turso). Lỗi tải thêm thì báo toast và giữ nguyên các trang đã có.
 */
export function VenueReviewList({
  venueId,
  initialPage,
  signedIn,
  onReport,
  pendingReview = null,
}: {
  venueId: number;
  initialPage: VenueReviewPage;
  signedIn: boolean;
  onReport?: (reviewId: number) => void;
  /** Đánh giá của mình đang gửi: thay dòng cùng id (sửa), không có thì lên đầu. */
  pendingReview?: VenueReviewView | null;
}) {
  const t = useTranslations("venueReviews");
  const q = useInfiniteQuery({
    queryKey: ["venue-reviews", venueId],
    queryFn: async ({ pageParam }) => {
      const r = await listVenueReviews({ venueId, offset: pageParam });
      if ("error" in r) throw new Error(r.error);
      return r.data;
    },
    initialPageParam: 0,
    initialData: { pages: [initialPage], pageParams: [0] },
    getNextPageParam: (p) => p.nextOffset,
    staleTime: 60_000,
    // Người dùng tự bấm lại "Xem thêm": thử lại ngầm (mặc định 3 lần) chỉ giữ
    // khung giả vài giây và gọi action thêm 3 lần trước khi báo lỗi.
    retry: false,
  });

  // Có đánh giá mới chen vào giữa hai lần tải thì offset trượt: khử trùng theo id.
  const seen = new Set<number>();
  const reviews: VenueReviewView[] = [];
  for (const p of q.data?.pages ?? []) {
    for (const r of p.reviews) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      reviews.push(r);
    }
  }

  if (pendingReview) {
    const at = reviews.findIndex((r) => r.id === pendingReview.id);
    if (at >= 0) reviews[at] = pendingReview;
    else reviews.unshift(pendingReview);
  }

  async function loadMore() {
    if (q.isFetchingNextPage) return;
    const r = await q.fetchNextPage();
    if (r.isError) toast.error(t("loadMoreError"));
  }

  if (reviews.length === 0) {
    return (
      <EmptyState
        variant="inline"
        icon={MessageSquareText}
        title={t("empty")}
        className="bg-muted/40 rounded-2xl border border-dashed"
      />
    );
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-3" data-testid="venue-review-list">
        <AnimatePresence initial={false}>
          {reviews.map((r) => (
            <motion.li
              key={r.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <VenueReviewItem
                review={r}
                signedIn={signedIn}
                onReport={onReport}
                pending={r === pendingReview}
              />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {q.isFetchingNextPage && <ReviewSkeleton report={signedIn} />}
      {q.hasNextPage && (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={q.isFetchingNextPage}
          className="bg-card/80 hover:bg-accent min-h-11 w-full rounded-xl border text-base font-medium backdrop-blur transition-colors active:scale-[0.98] disabled:opacity-50"
        >
          {t("loadMore")}
        </button>
      )}
    </div>
  );
}

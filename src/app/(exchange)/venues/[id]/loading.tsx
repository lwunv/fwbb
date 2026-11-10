import { Skeleton } from "@/components/ui/skeleton";
import { ReviewSkeleton } from "@/components/venues/reviews/review-skeleton";

/**
 * Khớp bố cục trang chi tiết sân: link quay lại, bản đồ nhỏ 16:9, tên và khu
 * vực, khối thông tin, chip tiện ích, khối giao lưu, khối đánh giá và thanh
 * nút dính đáy.
 * Không có file này thì route con dùng skeleton bản đồ toàn màn của /venues.
 */
export default function Loading() {
  return (
    <div
      aria-busy="true"
      className="mx-auto w-full max-w-2xl space-y-5 pb-28 md:pb-0"
    >
      <Skeleton className="h-11 w-32" />
      <Skeleton className="aspect-[16/9] w-full rounded-xl" />
      <div className="space-y-2">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-6 w-1/2" />
      </div>
      <div className="bg-card/80 divide-border/60 divide-y rounded-2xl border px-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            data-skeleton-row
            className="flex items-center justify-between gap-3 py-3"
          >
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-6 w-36" />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 w-28 rounded-full" />
        ))}
      </div>
      <div className="space-y-3">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-36 w-full rounded-2xl" />
      </div>
      {/* Khối đánh giá: tiêu đề, thẻ tổng điểm (cỡ "chưa đủ đánh giá", trạng
          thái của đa số sân lúc đầu), nút viết đánh giá, một thẻ đánh giá. */}
      <div className="space-y-3" data-skeleton-section="venue-reviews">
        <Skeleton className="h-7 w-40" />
        <div className="space-y-4">
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-11 w-full rounded-xl sm:w-44" />
          <ReviewSkeleton count={1} />
        </div>
      </div>
      <div className="bg-background/95 fixed inset-x-0 bottom-0 z-30 border-t px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] md:hidden">
        <div className="mx-auto flex max-w-2xl gap-2">
          <Skeleton className="h-11 flex-1 rounded-xl" />
          <Skeleton className="size-11 rounded-xl" />
          <Skeleton className="size-11 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

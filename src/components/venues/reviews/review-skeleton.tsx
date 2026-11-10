/** Thẻ giả đúng cỡ một đánh giá sân thật để danh sách không nhảy khi tải thêm. */
export function ReviewSkeleton({ count = 2 }: { count?: number }) {
  return (
    <div className="space-y-3" aria-hidden data-testid="review-skeleton">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="bg-card/80 space-y-3 rounded-2xl border p-4 backdrop-blur"
        >
          <div className="flex items-center gap-2">
            <div className="bg-muted h-7 w-28 animate-pulse rounded-full" />
            <div className="bg-muted h-4 w-20 animate-pulse rounded" />
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            {Array.from({ length: 6 }, (_, k) => (
              <div key={k} className="bg-muted h-5 animate-pulse rounded" />
            ))}
          </div>
          <div className="bg-muted h-5 w-full animate-pulse rounded" />
          <div className="bg-muted h-5 w-2/3 animate-pulse rounded" />
        </div>
      ))}
    </div>
  );
}

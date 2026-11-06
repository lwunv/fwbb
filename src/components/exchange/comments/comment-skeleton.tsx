/** Ba thẻ giả đúng cỡ bình luận thật để trang không nhảy khi dữ liệu về. */
export function CommentSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="bg-card/80 space-y-3 rounded-2xl border p-4 backdrop-blur"
        >
          <div className="flex items-center gap-2">
            <div className="bg-muted h-8 w-8 animate-pulse rounded-full" />
            <div className="bg-muted h-4 w-32 animate-pulse rounded" />
          </div>
          <div className="bg-muted h-4 w-full animate-pulse rounded" />
          <div className="bg-muted h-4 w-2/3 animate-pulse rounded" />
          <div className="bg-muted h-11 w-40 animate-pulse rounded-xl" />
        </div>
      ))}
    </div>
  );
}

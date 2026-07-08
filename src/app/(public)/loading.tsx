import { SkeletonCard, SkeletonList } from "@/components/shared/skeleton-card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading skeleton cho trang chủ (week view). Khớp layout thật: banner quỹ →
 * thẻ buổi (hàng chip chọn thứ full-width + ngày/giờ + trạng thái + sân + đếm
 * người) → thẻ "Danh sách" (tiêu đề + badge slot + danh sách vote) → chừa chỗ
 * cho thanh vote sticky đáy. `w-full` để không tràn ngang trên mobile.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-lg space-y-4">
      {/* Banner quỹ */}
      <SkeletonCard variant="stat" />

      {/* Thẻ buổi chơi */}
      <div className="border-border bg-card space-y-3 rounded-2xl border p-4">
        {/* Hàng chip chọn thứ — 3 chip full-width */}
        <div className="border-border/50 flex gap-2 border-b pb-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-11 flex-1 rounded-xl" />
          ))}
        </div>
        {/* Ngày + giờ (trái) / trạng thái + đếm ngược (phải) */}
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1.5">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-28" />
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Skeleton className="h-6 w-20 rounded-md" />
            <Skeleton className="h-4 w-16" />
          </div>
        </div>
        {/* Sân + đếm người */}
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-6 w-2/3" />
      </div>

      {/* Thẻ Danh sách: tiêu đề + badge slot + hàng vote */}
      <div className="border-border bg-card space-y-3 rounded-2xl border p-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-6 w-20 rounded-md" />
        </div>
        <SkeletonList variant="row" count={6} />
      </div>

      {/* Chừa chỗ cho thanh vote sticky đáy */}
      <div className="h-24" aria-hidden />
    </div>
  );
}

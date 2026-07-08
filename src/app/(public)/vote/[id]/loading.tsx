import { SkeletonList } from "@/components/shared/skeleton-card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Khớp layout trang vote 1 buổi: hàng back + tiêu đề + nút copy link →
 * SessionCard (ngày/giờ bên trái, badge + đếm ngược bên phải, sân, đếm người) →
 * thẻ "Danh sách" (tiêu đề + badge slot + danh sách vote). Chừa chỗ cho thanh
 * vote sticky đáy để không nhảy layout khi data về.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-lg space-y-4">
      {/* Back + tiêu đề + copy link */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-9 rounded-md" />
        <Skeleton className="h-6 w-24 flex-1" />
        <Skeleton className="h-9 w-9 rounded-md" />
      </div>

      {/* SessionCard: ngày/giờ + trạng thái + sân + đếm người */}
      <div className="border-border bg-card space-y-3 rounded-2xl border p-4">
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
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-6 w-2/3" />
      </div>

      {/* Thẻ Danh sách vote: tiêu đề + badge slot + hàng vote */}
      <div className="border-border bg-card space-y-3 rounded-2xl border p-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-6 w-20 rounded-md" />
        </div>
        <SkeletonList variant="row" count={6} />
      </div>

      {/* Chừa chỗ cho thanh vote sticky đáy */}
      <div className="h-28" aria-hidden />
    </div>
  );
}

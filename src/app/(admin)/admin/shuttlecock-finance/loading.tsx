import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonCard, SkeletonList } from "@/components/shared/skeleton-card";

/**
 * Loading skeleton cho /admin/shuttlecock-finance. Khớp layout thật: header
 * (icon + tiêu đề) → 4 stat tile → tab bán/mua (segmented) → search → danh
 * sách lịch sử. `pb-24 md:pb-28` chừa chỗ cho nút "Mua cầu" fixed đáy;
 * `w-full` để không tràn ngang; KHÔNG thêm p-4 (main đã bọc sẵn).
 */
export default function Loading() {
  return (
    <div className="w-full space-y-4 pb-24 md:pb-28">
      {/* Header: icon + tiêu đề */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-xl" />
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>

      {/* Stats: 4 stat tile (2-col mobile / 4-col md) */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} variant="stat" />
        ))}
      </div>

      {/* Tab bán / mua (segmented full-width) */}
      <div className="bg-muted flex gap-1 rounded-xl p-1.5">
        <Skeleton className="h-11 flex-1 rounded-xl" />
        <Skeleton className="h-11 flex-1 rounded-xl" />
      </div>

      {/* Thanh tìm kiếm */}
      <Skeleton className="h-10 w-full rounded-xl" />

      {/* Danh sách lịch sử mua / bán */}
      <SkeletonList variant="row" count={6} />
    </div>
  );
}

import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonCard, SkeletonList } from "@/components/shared/skeleton-card";

/**
 * Loading skeleton cho /admin/court-rent. Khớp layout thật: header (icon +
 * tiêu đề + chọn năm) → 4 stat tile tổng năm + 2 tile cố định/phát sinh → dải
 * chọn tháng → tóm tắt tháng → form ghi nhận → danh sách thanh toán.
 * `w-full` để không tràn ngang; KHÔNG thêm p-4 (main đã bọc sẵn).
 */
export default function Loading() {
  return (
    <div className="w-full space-y-4">
      {/* Header: icon + tiêu đề + chọn năm */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <div className="space-y-1.5">
            <Skeleton className="h-7 w-44" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <Skeleton className="h-10 w-32 rounded-lg" />
      </div>

      {/* Tổng cả năm: 4 stat tile (2-col mobile / 4-col sm) */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} variant="stat" />
        ))}
      </div>

      {/* Tách cố định / phát sinh: 2 stat tile */}
      <div className="grid grid-cols-2 gap-2">
        <SkeletonCard variant="stat" />
        <SkeletonCard variant="stat" />
      </div>

      {/* Dải chọn tháng (12 tháng, cuộn ngang) */}
      <Skeleton className="h-11 w-full rounded-lg" />

      {/* Tóm tắt tháng đang chọn */}
      <div className="border-border bg-card space-y-3 rounded-2xl border p-4">
        <Skeleton className="h-5 w-36" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-5 w-20" />
            </div>
          ))}
        </div>
      </div>

      {/* Form ghi nhận thanh toán */}
      <div className="border-border bg-card space-y-3 rounded-2xl border p-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5 rounded" />
          <Skeleton className="h-5 w-40" />
        </div>
        {/* Toggle loại (cố định / phát sinh) */}
        <div className="grid grid-cols-2 gap-1.5">
          <Skeleton className="h-10 rounded-lg" />
          <Skeleton className="h-10 rounded-lg" />
        </div>
        {/* 4 trường: năm / tháng / sân / số tiền */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-lg" />
          ))}
        </div>
        {/* Ghi chú */}
        <Skeleton className="h-10 w-full rounded-lg" />
        {/* Nút ghi nhận */}
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>

      {/* Danh sách thanh toán của tháng đang chọn */}
      <div className="border-border bg-card space-y-3 rounded-2xl border p-4">
        <Skeleton className="h-5 w-44" />
        <SkeletonList variant="row" count={5} />
      </div>
    </div>
  );
}

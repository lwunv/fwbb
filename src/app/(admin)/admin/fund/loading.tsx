import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonCard, SkeletonList } from "@/components/shared/skeleton-card";

/**
 * Loading skeleton cho /admin/fund. Khớp layout thật: FundDashboard (header +
 * 4 stat tiles + panel "Chi quỹ chung" + báo cáo Thu/Chi) → FundReport (search
 * + filter chips + danh sách member) → thẻ link giao dịch → ReconcilePanel.
 * `w-full` để không tràn ngang trên mobile (main đã bọc sẵn p-4).
 */
export default function Loading() {
  return (
    <div className="w-full space-y-6">
      {/* FundDashboard header: icon + tiêu đề + nút ghi nhận đóng quỹ */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <div className="space-y-1.5">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
        <Skeleton className="h-11 w-40 shrink-0 rounded-xl" />
      </div>

      {/* Overview: 4 stat tiles (2-col mobile / 4-col md) */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} variant="stat" />
        ))}
      </div>

      {/* Panel "Chi quỹ chung": tiêu đề + 2 nút (trả sân / mua cầu) */}
      <div className="border-border bg-card/80 rounded-2xl border p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3.5 w-24" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="h-11 rounded-xl" />
          <Skeleton className="h-11 rounded-xl" />
        </div>
      </div>

      {/* Báo cáo Thu/Chi: tiêu đề + tabs mốc thời gian + 3 tile tổng + danh sách */}
      <div className="border-border bg-card space-y-3 rounded-2xl border p-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-3.5 w-12" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-16 rounded-full" />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
        <SkeletonList variant="row" count={3} />
      </div>

      {/* FundReport: search + filter chips + danh sách member */}
      <div className="border-border bg-card space-y-4 rounded-2xl border p-4">
        <Skeleton className="h-10 w-full rounded-xl" />
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[42px] w-24 rounded-full" />
          ))}
        </div>
        <SkeletonList variant="row" count={6} />
      </div>

      {/* Thẻ link sang trang lịch sử giao dịch */}
      <div className="border-border bg-card flex items-center justify-between gap-3 rounded-2xl border p-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-44" />
          </div>
        </div>
        <Skeleton className="h-9 w-24 shrink-0 rounded-lg" />
      </div>

      {/* ReconcilePanel: tiêu đề + mô tả + nút chạy đối soát */}
      <div className="border-border bg-card rounded-2xl border p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-52" />
          </div>
          <Skeleton className="h-9 w-28 shrink-0 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

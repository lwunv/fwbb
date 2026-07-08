import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonList } from "@/components/shared/skeleton-card";

/**
 * Loading skeleton cho /admin/fund/transactions. Khớp layout thật: header (nút
 * quay lại + tiêu đề) → FundTransactionLog (tiêu đề + search/lọc chiều tiền +
 * tab nguồn + danh sách giao dịch). `w-full` để không tràn ngang trên mobile.
 */
export default function Loading() {
  return (
    <div className="w-full space-y-4">
      {/* Header: nút quay lại + tiêu đề */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-9 rounded-md" />
        <Skeleton className="h-6 w-48" />
      </div>

      {/* FundTransactionLog card */}
      <div className="border-border bg-card space-y-3 rounded-2xl border p-4">
        {/* Tiêu đề + mô tả */}
        <div className="space-y-1.5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
        {/* Search + select lọc chiều tiền */}
        <div className="grid gap-2 sm:grid-cols-[1fr_minmax(180px,220px)]">
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-10 w-full rounded-xl" />
        </div>
        {/* Tab nguồn (tất cả / tự động / admin) */}
        <Skeleton className="h-11 w-full rounded-xl" />
        {/* Danh sách giao dịch */}
        <SkeletonList variant="row" count={6} />
      </div>
    </div>
  );
}

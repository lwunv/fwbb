import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading skeleton cho trang Kho. Khớp layout thật (inventory-client): dải tab
 * Kho/Nhập/Sử dụng (TabSegment rounded) → tab Kho mặc định là các StockCard.
 * Mỗi StockCard: header (icon + tên/giá + badge) → hàng số tồn lớn + nút Sửa →
 * lưới chi tiết (đã mua / đã dùng / tồn) có border-t. `w-full` chống tràn ngang.
 */
function StockCardSkeleton() {
  return (
    <div className="border-border bg-card space-y-2 rounded-xl border p-3">
      {/* Header: icon + tên/giá + badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-4 shrink-0 rounded" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3.5 w-16" />
          </div>
        </div>
        <Skeleton className="h-6 w-16 rounded-full" />
      </div>
      {/* Hàng số tồn lớn + nút Sửa */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="ml-auto h-11 w-16 rounded-lg" />
      </div>
      {/* Lưới chi tiết */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="contents">
            <Skeleton className="h-3.5 w-16" />
            <Skeleton className="h-3.5 w-12 justify-self-end" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="w-full space-y-4">
      {/* Dải tab Kho / Nhập / Sử dụng (TabSegment rounded) */}
      <div className="bg-muted flex gap-1 rounded-xl p-1.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 flex-1 rounded-xl" />
        ))}
      </div>

      {/* Tab Kho: danh sách StockCard */}
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <StockCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

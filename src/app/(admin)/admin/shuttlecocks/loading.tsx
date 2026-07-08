import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading skeleton cho trang Cầu (brand-list). Khớp layout thật: danh sách thẻ
 * nhãn cầu (icon + tên/giá → badge + nút Sửa/Xóa/Bật-tắt) + thanh "Thêm nhãn"
 * cố định ở đáy. Wrapper `w-full` chống tràn ngang; padding trang do admin
 * layout (`main p-4 pb-24`) lo, không thêm ở đây.
 */
function BrandCardSkeleton() {
  return (
    <div className="border-border bg-card space-y-3 rounded-xl border p-4">
      {/* Icon + tên + giá */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-11 w-11 shrink-0 rounded-xl" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-5 w-24" />
        </div>
      </div>
      {/* Badge trạng thái + hàng nút */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-7 w-16 rounded-full" />
        <div className="flex-1" />
        <Skeleton className="h-[38px] w-16 rounded-lg" />
        <Skeleton className="h-[38px] w-[38px] rounded-lg" />
        <Skeleton className="h-[38px] w-20 rounded-lg" />
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="w-full">
      <div className="grid gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <BrandCardSkeleton key={i} />
        ))}
      </div>

      {/* Thanh "Thêm nhãn" cố định ở đáy */}
      <div className="bg-background/95 fixed right-0 bottom-0 left-0 z-30 border-t p-3 backdrop-blur lg:left-60">
        <Skeleton className="h-[46px] w-full rounded-xl" />
      </div>
    </div>
  );
}

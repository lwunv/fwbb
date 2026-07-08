import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading skeleton cho trang Sân (court-list). Khớp layout thật: danh sách thẻ
 * sân (icon + tên/địa chỉ/giá → badge + nút Sửa/Xóa/Bật-tắt) + thanh "Thêm sân"
 * cố định ở đáy. Wrapper dùng `pb-28` như trang thật để card cuối không bị thanh
 * fixed che; `w-full` chống tràn ngang. Padding trang do admin layout lo.
 */
function CourtCardSkeleton() {
  return (
    <div className="border-border bg-card space-y-3 rounded-xl border p-4">
      {/* Info: icon + tên/địa chỉ/giá */}
      <div className="flex items-start gap-3">
        <Skeleton className="h-11 w-11 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-5 w-2/5" />
          <Skeleton className="h-4 w-3/5" />
          <div className="flex flex-wrap gap-3 pt-0.5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-28" />
          </div>
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
    <div className="w-full pb-28">
      <div className="grid gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <CourtCardSkeleton key={i} />
        ))}
      </div>

      {/* Thanh "Thêm sân" cố định ở đáy */}
      <div className="bg-background/95 fixed right-0 bottom-0 left-0 z-30 border-t p-3 backdrop-blur lg:left-60">
        <Skeleton className="h-[46px] w-full rounded-xl" />
      </div>
    </div>
  );
}

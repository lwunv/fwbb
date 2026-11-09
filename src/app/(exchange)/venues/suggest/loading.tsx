import { Skeleton } from "@/components/ui/skeleton";

/** Một hàng form: nhãn rồi ô nhập cao 44px như `Input`. */
function FieldSkeleton({ label = "w-28" }: { label?: string }) {
  return (
    <div data-testid="suggest-skeleton-field" className="space-y-1.5">
      <Skeleton className={`h-5 ${label}`} />
      <Skeleton className="h-11 w-full rounded-xl" />
    </div>
  );
}

/**
 * Khớp trang đề xuất sân (tiêu đề, mô tả, các hàng của form sân, nút gửi dính
 * đáy trên điện thoại). Không có file này thì route con mượn skeleton bản đồ
 * toàn màn của `/venues/loading.tsx`.
 */
export default function Loading() {
  return (
    <div data-testid="suggest-skeleton" aria-hidden className="space-y-4">
      <div className="space-y-1">
        <Skeleton data-testid="suggest-skeleton-title" className="h-8 w-52" />
        <Skeleton className="h-6 w-full max-w-md" />
      </div>
      <div className="space-y-4">
        <FieldSkeleton label="w-20" />
        <div className="space-y-1.5">
          <FieldSkeleton label="w-36" />
          <Skeleton className="h-5 w-4/5" />
        </div>
        {/* Link "nhập toạ độ" (cao 44px) và nút chọn trên bản đồ. */}
        <div className="flex h-11 items-center">
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-11 w-full rounded-xl" />
        <FieldSkeleton label="w-16" />
        <div className="grid grid-cols-2 gap-3">
          <FieldSkeleton label="w-16" />
          <FieldSkeleton label="w-24" />
        </div>
        <FieldSkeleton label="w-32" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-20" />
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-11 w-24 rounded-full" />
            ))}
          </div>
        </div>
        <FieldSkeleton label="w-24" />
        <FieldSkeleton label="w-28" />
        <div
          data-testid="suggest-skeleton-submit"
          className="bg-background/95 sticky bottom-0 -mx-4 border-t p-3 sm:static sm:mx-0 sm:border-0 sm:p-0"
        >
          <Skeleton className="h-[46px] w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

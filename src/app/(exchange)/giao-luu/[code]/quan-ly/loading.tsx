import { Skeleton } from "@/components/ui/skeleton";

/** Khớp bố cục trang: hàng đầu, tiêu đề, ba ô tiền, tab và vài thẻ người. */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 pb-28 sm:pb-0">
      <div className="flex items-center justify-between">
        <Skeleton className="h-11 w-32" />
        <Skeleton className="h-11 w-24 rounded-xl" />
      </div>
      <Skeleton className="h-8 w-3/4" />
      <div className="grid grid-cols-3 gap-2">
        <Skeleton className="h-16 rounded-2xl" />
        <Skeleton className="h-16 rounded-2xl" />
        <Skeleton className="h-16 rounded-2xl" />
      </div>
      <Skeleton className="h-14 w-full rounded-xl" />
      <Skeleton className="h-36 w-full rounded-2xl" />
      <Skeleton className="h-36 w-full rounded-2xl" />
      <div className="bg-background/95 fixed inset-x-0 bottom-0 z-30 border-t p-3 sm:hidden">
        <Skeleton className="h-12 w-full rounded-xl" />
      </div>
    </div>
  );
}

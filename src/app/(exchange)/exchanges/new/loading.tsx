import { Skeleton } from "@/components/ui/skeleton";

/** Khớp form: link quay lại, tiêu đề, hai thẻ (sân + thời gian, cách thu phí), xem trước phí, nút chính. */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 pb-36 sm:pb-0">
      <Skeleton className="h-11 w-40" />
      <div className="space-y-2">
        <Skeleton className="h-8 w-60" />
        <Skeleton className="h-5 w-full" />
      </div>
      <div className="bg-card space-y-4 rounded-xl border p-4">
        <Skeleton className="h-12 w-full rounded-xl" />
        <div className="grid grid-cols-3 gap-3">
          <Skeleton className="h-12 rounded-xl" />
          <Skeleton className="h-12 rounded-xl" />
          <Skeleton className="h-12 rounded-xl" />
        </div>
        <Skeleton className="h-12 w-full rounded-xl" />
      </div>
      <div className="bg-card space-y-4 rounded-xl border p-4">
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="h-12 rounded-xl" />
          <Skeleton className="h-12 rounded-xl" />
        </div>
        <Skeleton className="h-12 w-full rounded-xl" />
      </div>
      <Skeleton className="h-24 w-full rounded-2xl" />
      <Skeleton className="h-12 w-full rounded-xl" />
    </div>
  );
}

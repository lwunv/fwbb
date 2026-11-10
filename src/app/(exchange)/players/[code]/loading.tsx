import { Skeleton } from "@/components/ui/skeleton";

/** Khớp bố cục hồ sơ: thẻ đầu (ảnh 64px, tên, nhãn, trình độ), hai khối số liệu. */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <div className="flex items-start gap-4 rounded-2xl border p-4">
        <Skeleton className="h-16 w-16 shrink-0 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-7 w-3/4" />
          <Skeleton className="h-7 w-16 rounded-full" />
          <Skeleton className="h-6 w-full" />
        </div>
      </div>
      <div className="space-y-2 rounded-2xl border p-4">
        <Skeleton className="h-6 w-40" />
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
      <div className="space-y-2 rounded-2xl border p-4">
        <Skeleton className="h-6 w-48" />
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    </div>
  );
}

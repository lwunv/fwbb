import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton trang thông báo admin: khớp 2 khối thật (đang âm quỹ + lịch sử). */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <Skeleton className="h-8 w-40" />
      {[4, 6].map((rows, i) => (
        <div key={i} className="space-y-3">
          <Skeleton className="h-6 w-48" />
          <div className="bg-card/80 space-y-2 rounded-xl border p-2">
            {Array.from({ length: rows }, (_, j) => (
              <Skeleton key={j} className="h-11 w-full rounded-lg" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

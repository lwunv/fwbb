import { Skeleton } from "@/components/ui/skeleton";

/** Khớp layout thật: hàng tab, hàng lọc, rồi các thẻ buổi (tiêu đề, dòng phụ, hàng nút). */
export default function Loading() {
  return (
    <div className="w-full space-y-4">
      <Skeleton className="h-11 w-56 rounded-xl" />
      <div className="flex gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-11 w-28 rounded-full" />
        ))}
      </div>
      <div className="grid gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="border-border bg-card space-y-3 rounded-xl border p-4"
          >
            <div className="space-y-1.5">
              <Skeleton className="h-5 w-3/5" />
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-4 w-1/3" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-11 w-24 rounded-lg" />
              <Skeleton className="h-11 w-24 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

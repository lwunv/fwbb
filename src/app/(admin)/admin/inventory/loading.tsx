import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonList } from "@/components/shared/skeleton-card";

export default function Loading() {
  return (
    <div className="space-y-4">
      {/* Tab switcher skeleton — 3 tabs ngang */}
      <div className="bg-muted flex gap-1 rounded-xl p-1">
        <Skeleton className="h-9 flex-1 rounded-lg" />
        <Skeleton className="h-9 flex-1 rounded-lg" />
        <Skeleton className="h-9 flex-1 rounded-lg" />
      </div>

      {/* Stock cards — mỗi card: icon tròn + tên brand + stock + badge */}
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="border-border bg-card flex items-center gap-3 rounded-2xl border p-4"
          >
            <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-3 w-12" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

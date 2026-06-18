import { SkeletonCard, SkeletonList } from "@/components/shared/skeleton-card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4 p-4">
      {/* Summary stat tiles — 4 ô số liệu ngang */}
      <div className="grid grid-cols-2 gap-3">
        <SkeletonCard variant="stat" />
        <SkeletonCard variant="stat" />
        <SkeletonCard variant="stat" />
        <SkeletonCard variant="stat" />
      </div>

      {/* Tab bar skeleton */}
      <div className="flex gap-2">
        <Skeleton className="h-9 w-28 rounded-full" />
        <Skeleton className="h-9 w-28 rounded-full" />
      </div>

      {/* Search bar skeleton */}
      <Skeleton className="h-10 w-full rounded-xl" />

      {/* List rows — purchase / usage history */}
      <SkeletonList variant="row" count={6} />
    </div>
  );
}

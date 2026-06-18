import { SkeletonCard, SkeletonList } from "@/components/shared/skeleton-card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      {/* FundBalanceBanner */}
      <SkeletonCard variant="stat" />

      {/* Week-day chip selector */}
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-16 shrink-0 rounded-full" />
        ))}
      </div>

      {/* SessionCard */}
      <SkeletonCard variant="session" />

      {/* Vote panel header */}
      <Skeleton className="h-5 w-32 rounded" />

      {/* Vote list rows */}
      <SkeletonList variant="row" count={6} />
    </div>
  );
}

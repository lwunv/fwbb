import { SkeletonCard, SkeletonList } from "@/components/shared/skeleton-card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      {/* Back nav + title */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-9 rounded-md" />
        <Skeleton className="h-6 w-32 rounded-md" />
        <Skeleton className="ml-auto h-9 w-9 rounded-md" />
      </div>

      {/* Session info card */}
      <SkeletonCard variant="session" />

      {/* Vote action buttons (play / dine / guest) */}
      <div className="flex gap-3">
        <Skeleton className="h-12 flex-1 rounded-xl" />
        <Skeleton className="h-12 flex-1 rounded-xl" />
        <Skeleton className="h-12 w-16 rounded-xl" />
      </div>

      {/* Vote list */}
      <SkeletonList variant="row" count={6} />
    </div>
  );
}

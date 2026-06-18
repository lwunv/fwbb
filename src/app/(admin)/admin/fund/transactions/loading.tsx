import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonList } from "@/components/shared/skeleton-card";

export default function Loading() {
  return (
    <div className="space-y-4">
      {/* Header: back button + title */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-9 rounded-md" />
        <Skeleton className="h-6 w-48 rounded-md" />
      </div>

      {/* Transaction list */}
      <SkeletonList variant="row" count={10} />
    </div>
  );
}

import { SkeletonCard, SkeletonList } from "@/components/shared/skeleton-card";
import { Skeleton } from "@/components/ui/skeleton";

// /admin/finance redirects to /admin/fund — skeleton mirrors /admin/fund shape.
export default function Loading() {
  return (
    <div className="space-y-6">
      {/* Header: icon + title + button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <div className="space-y-1.5">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-3.5 w-24" />
          </div>
        </div>
        <Skeleton className="h-10 w-36 rounded-xl" />
      </div>

      {/* Overview: 4 stat cards (2-col mobile, 4-col desktop) */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SkeletonCard variant="stat" />
        <SkeletonCard variant="stat" />
        <SkeletonCard variant="stat" />
        <SkeletonCard variant="stat" />
      </div>

      {/* Chi quỹ chung card: title + 2 action buttons */}
      <div className="bg-card/80 rounded-2xl border p-4">
        <div className="mb-3 flex items-center justify-between">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3.5 w-24" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="h-11 rounded-xl" />
          <Skeleton className="h-11 rounded-xl" />
        </div>
      </div>

      {/* SessionFinanceReport: card với list rows */}
      <div className="bg-card/80 rounded-2xl border p-4">
        <Skeleton className="mb-3 h-4 w-36" />
        <SkeletonList variant="row" count={3} />
      </div>

      {/* FundReport: card với list member rows */}
      <div className="bg-card/80 rounded-2xl border p-4">
        <div className="mb-3 flex items-center justify-between">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-7 w-20 rounded-lg" />
        </div>
        <SkeletonList variant="row" count={5} />
      </div>

      {/* Transactions link card */}
      <div className="border-border bg-card flex items-center justify-between rounded-2xl border p-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-40" />
          </div>
        </div>
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>
    </div>
  );
}

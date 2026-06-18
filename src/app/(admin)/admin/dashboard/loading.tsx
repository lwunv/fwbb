import { SkeletonCard, SkeletonList } from "@/components/shared/skeleton-card";
import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton helper: SectionCard shell — header row + content slot */
function SectionSkeleton({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-border bg-card space-y-4 rounded-2xl border p-4">
      {/* header: icon + title + action button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5 rounded-md" />
          <Skeleton className="h-5 w-36" />
        </div>
        <Skeleton className="h-8 w-20 rounded-lg" />
      </div>
      {children}
    </div>
  );
}

export default function Loading() {
  return (
    <div className="space-y-6">
      {/* App name editor row */}
      <Skeleton className="h-6 w-48" />

      {/* 4 StatCards — 2-col mobile / 4-col desktop */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SkeletonCard variant="stat" />
        <SkeletonCard variant="stat" />
        <SkeletonCard variant="stat" />
        <SkeletonCard variant="stat" />
      </div>

      {/* Upcoming session SectionCard */}
      <SectionSkeleton>
        {/* date + time row */}
        <div className="space-y-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-5 w-40" />
        </div>
        {/* location row */}
        <Skeleton className="h-5 w-48" />
        {/* court + shuttlecock selectors */}
        <div className="space-y-2">
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-10 w-full rounded-xl" />
        </div>
        {/* cost stats row */}
        <div className="grid grid-cols-3 gap-2">
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-14 rounded-xl" />
        </div>
        {/* finalize / manage buttons */}
        <div className="flex gap-2">
          <Skeleton className="h-10 flex-1 rounded-xl" />
          <Skeleton className="h-10 flex-1 rounded-xl" />
        </div>
      </SectionSkeleton>

      {/* DefaultSettings card */}
      <div className="border-border bg-card space-y-3 rounded-2xl border p-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-8 w-16 rounded-lg" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="h-10 rounded-lg" />
          <Skeleton className="h-10 rounded-lg" />
        </div>
      </div>

      {/* Finance overview SectionCard — 2 rows of 3 StatTiles */}
      <SectionSkeleton>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="col-span-2 h-16 rounded-xl sm:col-span-1" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="col-span-2 h-16 rounded-xl sm:col-span-1" />
        </div>
      </SectionSkeleton>

      {/* Court rent SectionCard — 3 StatTiles + progress bar */}
      <SectionSkeleton>
        <div className="grid grid-cols-3 gap-2">
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-14 rounded-xl" />
        </div>
        <Skeleton className="h-2 w-full rounded-full" />
        <Skeleton className="h-3 w-40" />
      </SectionSkeleton>

      {/* Owing members SectionCard — 3 member rows */}
      <SectionSkeleton>
        <SkeletonList variant="row" count={3} />
      </SectionSkeleton>

      {/* Recent transactions SectionCard — 5 tx rows */}
      <SectionSkeleton>
        <SkeletonList variant="row" count={5} />
      </SectionSkeleton>
    </div>
  );
}

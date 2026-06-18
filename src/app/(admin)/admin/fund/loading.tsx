import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonList } from "@/components/shared/skeleton-card";

export default function Loading() {
  return (
    <div className="space-y-6">
      {/* FundDashboard ---------------------------------------------------- */}

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

      {/* Overview: 4 stat tiles (2-col mobile / 4-col md) */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="border-border bg-card flex flex-col gap-2 rounded-2xl border p-4"
          >
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-24" />
          </div>
        ))}
      </div>

      {/* Chi quỹ chung panel */}
      <div className="bg-card/80 rounded-2xl border p-4">
        <div className="mb-3 flex items-center justify-between">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3.5 w-20" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="h-11 rounded-xl" />
          <Skeleton className="h-11 rounded-xl" />
        </div>
      </div>

      {/* SessionFinanceReport — collapsible accordion-like section */}
      <div className="border-border bg-card space-y-3 rounded-2xl border p-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-4 w-16" />
        </div>
        <SkeletonList variant="row" count={3} />
      </div>

      {/* FundReport Card -------------------------------------------------- */}
      <div className="border-border bg-card space-y-4 rounded-2xl border p-4">
        {/* Search bar */}
        <Skeleton className="h-10 w-full rounded-xl" />

        {/* Filter chips */}
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[42px] w-24 rounded-full" />
          ))}
        </div>

        {/* Member rows */}
        <SkeletonList variant="row" count={6} />
      </div>

      {/* Transactions link card ------------------------------------------- */}
      <div className="border-border bg-card flex items-center justify-between rounded-2xl border p-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-52" />
          </div>
        </div>
        <Skeleton className="h-9 w-24 rounded-lg" />
      </div>

      {/* ReconcilePanel --------------------------------------------------- */}
      <div className="border-border bg-card space-y-2 rounded-2xl border p-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3.5 w-48" />
        <Skeleton className="h-9 w-36 rounded-lg" />
      </div>
    </div>
  );
}

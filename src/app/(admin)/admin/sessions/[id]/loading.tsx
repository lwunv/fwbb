import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonList } from "@/components/shared/skeleton-card";

export default function Loading() {
  return (
    <div className="w-full space-y-3 pb-28">
      {/* Header — back button + session title + status badge (1 flex row) */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-6 w-20 shrink-0 rounded-full" />
      </div>

      {/* Court Selector card */}
      <div className="border-border bg-card space-y-3 rounded-xl border p-4">
        <Skeleton className="h-4 w-24" />
        <div className="flex gap-2">
          <Skeleton className="h-9 flex-1 rounded-xl" />
          <Skeleton className="h-9 w-20 rounded-xl" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-20" />
        </div>
      </div>

      {/* Shuttlecock Selector card */}
      <div className="border-border bg-card space-y-3 rounded-xl border p-4">
        <Skeleton className="h-4 w-32" />
        <div className="flex gap-2">
          <Skeleton className="h-9 flex-1 rounded-xl" />
          <Skeleton className="h-9 w-16 rounded-xl" />
        </div>
      </div>

      {/* Cost summary card (blue tint, compact) — 4 rows + per-head summary */}
      <div className="border-border bg-card space-y-2 rounded-xl border px-3 py-2">
        <div className="flex items-center justify-between">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-3.5 w-20" />
        </div>
        <div className="flex items-center justify-between">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3.5 w-16" />
        </div>
        <div className="flex items-center justify-between">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-3.5 w-16" />
        </div>
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-24 font-bold" />
          <Skeleton className="h-4 w-28" />
        </div>
        {/* per-head row */}
        <div className="flex items-center justify-between pt-0.5">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>

      {/* MinDeductionToggle strip — 1-line: icon + label + switch */}
      <div className="flex items-center gap-3 rounded-xl border px-3 py-2">
        <Skeleton className="h-4 w-4 rounded" />
        <Skeleton className="h-3.5 flex-1" />
        <Skeleton className="h-5 w-10 rounded-full" />
      </div>

      {/* Search input */}
      <Skeleton className="h-10 w-full rounded-xl" />

      {/* Member rows — avatar 36px + name/balance + play/dine toggles */}
      <SkeletonList variant="row" count={7} />
    </div>
  );
}

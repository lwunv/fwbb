import { Skeleton } from "@/components/ui/skeleton";

function ChartCardSkeleton({ hasFilter = false }: { hasFilter?: boolean }) {
  return (
    <div className="bg-card space-y-3 rounded-xl border p-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-36 rounded" />
        {hasFilter && <Skeleton className="h-8 w-28 rounded-md" />}
      </div>
      <Skeleton className="h-48 w-full rounded-lg" />
    </div>
  );
}

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-lg space-y-4">
      {/* Card 1: Active members chart + year filter */}
      <ChartCardSkeleton hasFilter />

      {/* Card 2: Monthly expenses chart + group toggle */}
      <div className="bg-card space-y-3 rounded-xl border p-4">
        <Skeleton className="h-5 w-40 rounded" />
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>

      {/* Card 3: Attendance trend chart */}
      <ChartCardSkeleton />
    </div>
  );
}

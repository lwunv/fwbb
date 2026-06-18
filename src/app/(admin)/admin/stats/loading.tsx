import { Skeleton } from "@/components/ui/skeleton";

function ChartCardSkeleton({
  hasSegmentedControl = false,
}: {
  hasSegmentedControl?: boolean;
}) {
  return (
    <div className="bg-card/80 space-y-4 rounded-xl border p-4 shadow-sm">
      {/* Card header */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-36 rounded-md" />
        <Skeleton className="h-8 w-28 rounded-md" />
      </div>
      {/* Segmented control (monthly expenses card only) */}
      {hasSegmentedControl && (
        <div className="bg-muted flex gap-1 rounded-lg p-1">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-8 flex-1 rounded-md" />
          ))}
        </div>
      )}
      {/* Chart area */}
      <Skeleton className="h-52 w-full rounded-lg" />
    </div>
  );
}

export default function Loading() {
  return (
    <div className="space-y-4">
      {/* Active members chart */}
      <ChartCardSkeleton />
      {/* Monthly expenses chart (has segmented control) */}
      <ChartCardSkeleton hasSegmentedControl />
      {/* Attendance trend chart */}
      <ChartCardSkeleton />
    </div>
  );
}

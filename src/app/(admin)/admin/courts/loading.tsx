import { Skeleton } from "@/components/ui/skeleton";

function CourtCardSkeleton() {
  return (
    <div className="bg-card space-y-3 rounded-xl border p-4">
      {/* Info row: icon + text block */}
      <div className="flex items-start gap-3">
        <Skeleton className="h-11 w-11 shrink-0 rounded-xl" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-5 w-2/5 rounded" />
          <Skeleton className="h-4 w-3/5 rounded" />
          <div className="flex gap-3 pt-0.5">
            <Skeleton className="h-4 w-24 rounded" />
            <Skeleton className="h-4 w-24 rounded" />
          </div>
        </div>
      </div>
      {/* Actions row: badge + buttons */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-7 w-16 rounded-full" />
        <div className="flex-1" />
        <Skeleton className="h-8 w-16 rounded-md" />
        <Skeleton className="h-8 w-8 rounded-md" />
        <Skeleton className="h-8 w-20 rounded-md" />
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="grid gap-3 p-4 pb-20">
      {Array.from({ length: 5 }).map((_, i) => (
        <CourtCardSkeleton key={i} />
      ))}
    </div>
  );
}

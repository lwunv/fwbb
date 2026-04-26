import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-lg space-y-4 p-4">
      {/* Header link */}
      <Skeleton className="mb-4 h-4 w-24" />

      {/* Title block */}
      <div className="mb-6 space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>

      {/* Stats/Costs card skeleton */}
      <div className="bg-card space-y-3 rounded-xl border p-4">
        <Skeleton className="mb-2 h-5 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-5/6" />
      </div>

      {/* Tabs/Actions skeleton */}
      <div className="my-4 flex gap-2">
        <Skeleton className="h-10 flex-1 rounded-xl" />
        <Skeleton className="h-10 flex-1 rounded-xl" />
      </div>

      {/* List skeleton */}
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-3 p-2">
            <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-8 w-16 shrink-0 rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
}

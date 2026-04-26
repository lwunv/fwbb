import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-lg space-y-4 p-4">
      {/* Title skeleton */}
      <Skeleton className="h-8 w-40" />

      {/* Filter skeleton */}
      <div className="mb-4 flex gap-2">
        <Skeleton className="h-10 flex-1" />
        <Skeleton className="h-10 w-24" />
      </div>

      {/* Cards skeleton */}
      <div className="space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-card space-y-3 rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-5 w-16" />
            </div>
            <Skeleton className="h-4 w-48" />
            <div className="flex items-center justify-between pt-2">
              <Skeleton className="h-8 w-24 rounded-full" />
              <Skeleton className="h-8 w-24 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

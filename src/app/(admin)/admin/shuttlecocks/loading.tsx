import { Skeleton } from "@/components/ui/skeleton";

function BrandCardSkeleton() {
  return (
    <div className="bg-card space-y-3 rounded-xl border p-4">
      {/* icon + name + price */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-11 w-11 shrink-0 rounded-xl" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-32 rounded" />
          <Skeleton className="h-4 w-20 rounded" />
        </div>
      </div>
      {/* badge + action buttons */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-6 w-16 rounded-full" />
        <div className="flex-1" />
        <Skeleton className="h-8 w-20 rounded-md" />
        <Skeleton className="h-8 w-8 rounded-md" />
        <Skeleton className="h-8 w-20 rounded-md" />
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="grid gap-3 p-4 pb-24">
      {Array.from({ length: 5 }).map((_, i) => (
        <BrandCardSkeleton key={i} />
      ))}
    </div>
  );
}

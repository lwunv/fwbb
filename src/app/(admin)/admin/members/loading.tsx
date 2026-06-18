import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton cho 1 member card — khớp CardContent của MemberList */
function MemberCardSkeleton() {
  return (
    <div className="border-border bg-card space-y-3 rounded-xl border p-4">
      {/* Info row: avatar + tên + badges + balance + action buttons */}
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
        {/* Tên */}
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-32" />
        </div>
        {/* Fund badge */}
        <Skeleton className="h-5 w-16 rounded-full" />
        {/* Partner badge */}
        <Skeleton className="h-5 w-14 rounded-full" />
        {/* Balance */}
        <Skeleton className="h-5 w-16 rounded-md" />
        {/* Crown + Delete + Lock buttons */}
        <Skeleton className="h-8 w-8 rounded-md" />
        <Skeleton className="h-8 w-8 rounded-md" />
        <Skeleton className="h-8 w-16 rounded-md" />
      </div>
      {/* Nickname edit row (dashed border row) */}
      <Skeleton className="h-10 w-full rounded-xl" />
    </div>
  );
}

export default function Loading() {
  return (
    <div className="space-y-3">
      {/* Search input */}
      <Skeleton className="h-10 w-full rounded-xl" />

      {/* Filter pills + count */}
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-2">
          <Skeleton className="h-8 w-12 rounded-full" />
          <Skeleton className="h-8 w-20 rounded-full" />
          <Skeleton className="h-8 w-20 rounded-full" />
          <Skeleton className="h-8 w-20 rounded-full" />
          <Skeleton className="h-8 w-20 rounded-full" />
        </div>
        <Skeleton className="h-4 w-10 shrink-0" />
      </div>

      {/* Sort bar */}
      <div className="flex items-center justify-end gap-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-9 w-36 rounded-lg" />
      </div>

      {/* Member cards */}
      <div className="grid gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <MemberCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

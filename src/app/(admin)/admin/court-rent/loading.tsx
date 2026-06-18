import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonCard, SkeletonList } from "@/components/shared/skeleton-card";

export default function Loading() {
  return (
    <div className="space-y-4 p-4">
      {/* Year selector */}
      <Skeleton className="h-9 w-32 rounded-lg" />

      {/* Year-total stat tiles (paid / remaining / expected) */}
      <div className="grid grid-cols-3 gap-3">
        <SkeletonCard variant="stat" />
        <SkeletonCard variant="stat" />
        <SkeletonCard variant="stat" />
      </div>

      {/* Monthly grid — 12 ô, 3 cột trên mobile */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>

      {/* Month detail panel: form ghi nhận + danh sách payments */}
      <div className="border-border/40 bg-card/60 space-y-3 rounded-2xl border p-4 backdrop-blur">
        {/* Panel header */}
        <Skeleton className="h-5 w-40 rounded" />

        {/* Form fields (sân, tháng, số tiền, loại, ghi chú) */}
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-9 w-28 rounded-lg" />

        {/* Payments list */}
        <SkeletonList variant="row" count={5} />
      </div>
    </div>
  );
}

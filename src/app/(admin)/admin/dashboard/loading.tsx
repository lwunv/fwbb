import { SkeletonCard, SkeletonList } from "@/components/shared/skeleton-card";

export default function Loading() {
  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-2 gap-3">
        <SkeletonCard variant="stat" />
        <SkeletonCard variant="stat" />
        <SkeletonCard variant="stat" />
        <SkeletonCard variant="stat" />
      </div>
      <SkeletonList variant="row" count={4} />
    </div>
  );
}

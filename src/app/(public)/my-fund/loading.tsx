import { SkeletonList, SkeletonCard } from "@/components/shared/skeleton-card";

export default function Loading() {
  return (
    <div className="space-y-3 p-4">
      <SkeletonCard variant="stat" />
      <SkeletonList variant="row" count={6} />
    </div>
  );
}

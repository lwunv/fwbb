import { SkeletonCard, SkeletonList } from "@/components/shared/skeleton-card";

export default function Loading() {
  return (
    <div className="space-y-4 p-4">
      <SkeletonCard variant="stat" />
      <SkeletonList variant="session" count={3} />
    </div>
  );
}

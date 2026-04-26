import { SkeletonList } from "@/components/shared/skeleton-card";

export default function Loading() {
  return (
    <div className="space-y-4 p-4">
      <SkeletonList variant="row" count={1} />
      <SkeletonList variant="debt" count={4} />
    </div>
  );
}

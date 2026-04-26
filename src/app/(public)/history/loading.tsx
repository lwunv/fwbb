import { SkeletonList } from "@/components/shared/skeleton-card";

export default function Loading() {
  return (
    <div className="space-y-3 p-4">
      <SkeletonList variant="session" count={5} />
    </div>
  );
}

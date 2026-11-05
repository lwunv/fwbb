import { Skeleton } from "@/components/ui/skeleton";

/** Khớp bố cục trang: tiêu đề, một tiêu đề mục và các thẻ buổi. */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 pb-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-6 w-40" />
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-56 w-full rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

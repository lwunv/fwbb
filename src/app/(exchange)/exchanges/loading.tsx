import { Skeleton } from "@/components/ui/skeleton";

/** Khớp layout `/exchanges`: tiêu đề + giới thiệu, chuyển chế độ xem và danh sách thẻ. */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 pb-24 sm:pb-0">
      <div className="space-y-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-5 w-full max-w-md" />
      </div>
      <Skeleton className="h-[52px] w-full rounded-xl" />
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-56 w-full rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

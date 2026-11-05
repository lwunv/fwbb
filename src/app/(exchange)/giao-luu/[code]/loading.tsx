import { Skeleton } from "@/components/ui/skeleton";

/** Khớp bố cục bài: dòng host, tiêu đề, các chip, hai khối phí và slot. */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 pb-28 sm:pb-0">
      <Skeleton className="h-11 w-28" />
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-8 rounded-full" />
        <Skeleton className="h-5 w-48" />
      </div>
      <Skeleton className="h-8 w-3/4" />
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-8 w-44 rounded-full" />
        <Skeleton className="h-8 w-36 rounded-full" />
        <Skeleton className="h-8 w-24 rounded-full" />
      </div>
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-28 w-full rounded-2xl" />
      <Skeleton className="h-36 w-full rounded-2xl" />
      <div className="bg-background/95 fixed inset-x-0 bottom-0 z-30 border-t p-3 sm:hidden">
        <Skeleton className="h-12 w-full rounded-xl" />
      </div>
    </div>
  );
}

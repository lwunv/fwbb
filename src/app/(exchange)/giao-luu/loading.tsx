import { Skeleton } from "@/components/ui/skeleton";

/** Khớp layout `/giao-luu`: tiêu đề + giới thiệu, ô trống có nút. */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 pb-24 sm:pb-0">
      <div className="space-y-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-5 w-full max-w-md" />
      </div>
      <div className="border-border bg-card/40 flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-10">
        <Skeleton className="h-14 w-14 rounded-full" />
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-64 max-w-full" />
        <Skeleton className="h-11 w-44 rounded-xl" />
      </div>
    </div>
  );
}

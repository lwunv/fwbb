import { Skeleton } from "@/components/ui/skeleton";

/** Khớp form đăng nhập: link quay lại, tiêu đề, thẻ widget, nút chính. */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-md space-y-4 pb-36 sm:pb-0">
      <Skeleton className="h-11 w-40" />
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-5 w-full" />
      </div>
      <div className="bg-card space-y-4 rounded-xl border p-4">
        <Skeleton className="h-[65px] w-full rounded-lg" />
        <Skeleton className="mx-auto h-4 w-16" />
        <Skeleton className="h-[65px] w-full rounded-lg" />
        <Skeleton className="h-11 w-full rounded-full" />
      </div>
      <Skeleton className="h-12 w-full rounded-xl" />
    </div>
  );
}

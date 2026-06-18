import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonCard } from "@/components/shared/skeleton-card";

export default function Loading() {
  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      {/* Profile card: avatar + tên + picker theme/ngôn ngữ */}
      <div className="bg-card/80 space-y-4 rounded-2xl border p-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <Skeleton className="h-16 w-16 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-32 rounded" />
            <Skeleton className="h-4 w-20 rounded" />
          </div>
        </div>
        {/* theme / language pickers */}
        <div className="flex gap-2">
          <Skeleton className="h-9 flex-1 rounded-lg" />
          <Skeleton className="h-9 flex-1 rounded-lg" />
        </div>
      </div>

      {/* 3 ô số liệu: chi tháng / còn nợ / quỹ */}
      <div className="grid grid-cols-3 gap-2">
        <SkeletonCard variant="stat" />
        <SkeletonCard variant="stat" />
        <SkeletonCard variant="stat" />
      </div>

      {/* Thẻ đặt mật khẩu */}
      <div className="bg-card/80 space-y-3 rounded-2xl border p-4 backdrop-blur">
        <Skeleton className="h-5 w-40 rounded" />
        <Skeleton className="h-4 w-56 rounded" />
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
    </div>
  );
}

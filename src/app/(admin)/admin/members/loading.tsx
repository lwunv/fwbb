import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton cho 1 member card — khớp CardContent của MemberList */
function MemberCardSkeleton() {
  return (
    <div className="border-border bg-card rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* Trái: avatar (44px) + tên + trạng thái quỹ / partner */}
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <div className="flex items-center gap-3">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
          </div>
        </div>
        {/* Phải: số dư + action (rớt xuống dòng riêng full-width trên mobile) */}
        <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-normal">
          <Skeleton className="h-8 w-16 rounded-md" />
          <Skeleton className="h-11 w-11 rounded-md" />
          <Skeleton className="h-11 w-20 rounded-md" />
          <Skeleton className="h-11 w-11 rounded-md" />
        </div>
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="w-full">
      {/* Header — eyebrow + tiêu đề lớn + số lượng + nút thêm (desktop) */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="hidden h-11 w-32 rounded-lg md:block" />
      </div>

      {/* Search input */}
      <Skeleton className="mb-3 h-10 w-full rounded-xl" />

      {/* Filter pills (kèm số đếm) + sort — cùng 1 hàng, wrap trên mobile */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 gap-2">
          <Skeleton className="h-8 w-16 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-9 w-40 rounded-lg sm:w-56" />
        </div>
      </div>

      {/* Member cards */}
      <div className="grid gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <MemberCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

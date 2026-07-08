import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  // Static widths for the filter pills — dynamic `w-${n}` classes don't survive
  // Tailwind's JIT so they must be literal.
  const filterPillWidths = ["w-16", "w-20", "w-24", "w-24", "w-16"];

  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* Week strip card — chip ngày T2/T4/T6 trong tuần */}
      <div className="bg-card/60 mb-3 rounded-xl border p-3">
        <Skeleton className="mb-2 h-3 w-20" />
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-9 w-16 rounded-lg" />
          ))}
        </div>
      </div>

      {/* Top bar — filter pills (flex-1) + nút tạo buổi (shrink-0) */}
      <div className="mb-3 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 gap-1.5 overflow-hidden">
          {filterPillWidths.map((w, i) => (
            <Skeleton key={i} className={`h-8 shrink-0 rounded-full ${w}`} />
          ))}
        </div>
        <Skeleton className="h-9 w-9 shrink-0 rounded-md sm:w-32" />
      </div>

      {/* Filter phụ — khoảng ngày (trái) + đổi kiểu xem thẻ/danh sách (phải) */}
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-9 w-44 rounded-lg" />
        </div>
        <div className="ml-auto flex gap-1.5">
          <Skeleton className="h-8 w-16 rounded-full" />
          <Skeleton className="h-8 w-16 rounded-full" />
        </div>
      </div>

      {/* Session cards */}
      <div className="grid gap-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="bg-card space-y-3 rounded-xl border p-4">
            {/* Header: date + time + week strip (trái) / status badge (phải) */}
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Skeleton className="h-5 w-36" />
                  <Skeleton className="h-4 w-24" />
                </div>
                {/* WeekStrip mini (căn giữa) */}
                <div className="flex justify-center gap-1">
                  {[1, 2, 3, 4, 5].map((d) => (
                    <Skeleton key={d} className="h-5 w-7 rounded" />
                  ))}
                </div>
              </div>
              <Skeleton className="h-6 w-20 shrink-0 rounded-full" />
            </div>

            {/* Court name row */}
            <Skeleton className="h-4 w-40" />

            {/* Cost stats — Chi / Thu / Lãi (3-col stat tiles) */}
            <div className="grid grid-cols-3 gap-2">
              <Skeleton className="h-16 rounded-xl" />
              <Skeleton className="h-16 rounded-xl" />
              <Skeleton className="h-16 rounded-xl" />
            </div>

            {/* Members block toggle bar (🏸/🍻 counts + chevron) */}
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
}

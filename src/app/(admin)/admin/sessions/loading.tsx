import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl">
      {/* Week strip skeleton — chip ngày T2/T4/T6 trong tuần */}
      <div className="bg-card/60 mb-3 rounded-xl border p-3">
        <Skeleton className="mb-2 h-3 w-20" />
        <div className="flex gap-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-9 w-16 rounded-lg" />
          ))}
        </div>
      </div>

      {/* Top bar — filter pills (flex-1) + nút tạo buổi (shrink-0) */}
      <div className="mb-3 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 gap-1.5 overflow-hidden">
          {[80, 72, 96, 72, 72].map((w, i) => (
            <Skeleton
              key={i}
              className={`h-8 w-${w === 80 ? "20" : w === 72 ? "18" : "24"} rounded-full`}
              style={{ minWidth: w }}
            />
          ))}
        </div>
        <Skeleton className="h-9 w-9 shrink-0 rounded-md" />
      </div>

      {/* Session cards */}
      <div className="grid gap-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="bg-card rounded-xl border p-4">
            {/* Header: date + status badge */}
            <div className="mb-2 flex items-start justify-between">
              <div className="space-y-1.5">
                {/* Date + time row */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Skeleton className="h-5 w-36" />
                  <Skeleton className="h-4 w-24" />
                </div>
                {/* WeekStrip mini */}
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((d) => (
                    <Skeleton key={d} className="h-5 w-7 rounded" />
                  ))}
                </div>
              </div>
              {/* Status badge */}
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>

            {/* Court name row */}
            <Skeleton className="mb-3 h-4 w-40" />

            {/* Stats row — player count / diner count / cost chips */}
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-7 w-20 rounded-full" />
              <Skeleton className="h-7 w-20 rounded-full" />
              <Skeleton className="h-7 w-24 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

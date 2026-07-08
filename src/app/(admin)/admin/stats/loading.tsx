import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading skeleton cho trang Thống kê (stats-client). Khớp 3 thẻ biểu đồ thật:
 * (1) Thành viên tích cực — header có ô chọn năm, biểu đồ ~300px;
 * (2) Chi phí — có dải segmented 4 mốc + biểu đồ ~350px;
 * (3) Điểm danh — dòng trung bình + biểu đồ ~300px.
 * Chiều cao biểu đồ đặt sát UI thật để không nhảy layout. `w-full` chống tràn.
 */
function ChartCardSkeleton({
  hasHeaderAction = false,
  hasSegmentedControl = false,
  hasAvgLine = false,
  chartHeight = "h-[300px]",
}: {
  hasHeaderAction?: boolean;
  hasSegmentedControl?: boolean;
  hasAvgLine?: boolean;
  chartHeight?: string;
}) {
  return (
    <div className="border-border bg-card space-y-4 rounded-xl border p-4 shadow-sm">
      {/* Header: tiêu đề + ô chọn năm (chỉ thẻ đầu) */}
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-5 w-36" />
        {hasHeaderAction && <Skeleton className="h-9 w-36 rounded-lg" />}
      </div>
      {/* Dải segmented 4 mốc (chỉ thẻ chi phí) */}
      {hasSegmentedControl && (
        <div className="bg-muted flex gap-1 rounded-lg p-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 flex-1 rounded-md" />
          ))}
        </div>
      )}
      {/* Dòng "trung bình" (chỉ thẻ điểm danh) */}
      {hasAvgLine && <Skeleton className="h-3 w-32" />}
      {/* Vùng biểu đồ */}
      <Skeleton className={`w-full rounded-lg ${chartHeight}`} />
    </div>
  );
}

export default function Loading() {
  return (
    <div className="w-full space-y-4">
      {/* Thành viên tích cực */}
      <ChartCardSkeleton hasHeaderAction />
      {/* Chi phí (segmented control) */}
      <ChartCardSkeleton hasSegmentedControl chartHeight="h-[350px]" />
      {/* Điểm danh */}
      <ChartCardSkeleton hasAvgLine />
    </div>
  );
}

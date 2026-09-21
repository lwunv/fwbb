import { Skeleton } from "@/components/ui/skeleton";

/**
 * Trang này render CÙNG `StatsClient` với `/admin/stats`, nên skeleton phải
 * khớp đúng chiều cao biểu đồ thật, nếu không trang nhảy khi dữ liệu về.
 *
 * Chiều cao lấy từ chính component biểu đồ:
 * - `active-members-chart.tsx:70` → `Math.max(300, số dòng * 44)`, sàn 300px
 * - `monthly-expenses-chart.tsx:77` → 350px
 * - `attendance-chart.tsx:54` → 300px
 *
 * Bản cũ ở đây để `h-48` (192px) cho cả ba, lệch tới ~370px tổng cộng. Bản
 * admin đã sửa đúng từ trước nhưng bản public bị bỏ quên — hai file skeleton
 * cho cùng một UI là chỗ rất dễ lệch, sửa một bên quên bên kia.
 */
function ChartCardSkeleton({
  hasFilter = false,
  hasSegmentedControl = false,
  chartHeight = "h-[300px]",
}: {
  hasFilter?: boolean;
  hasSegmentedControl?: boolean;
  chartHeight?: string;
}) {
  return (
    <div className="bg-card space-y-3 rounded-xl border p-4">
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-5 w-36 rounded" />
        {hasFilter && <Skeleton className="h-9 w-36 rounded-lg" />}
      </div>
      {/* Dải chọn nhóm chi phí: 4 ô trong nền muted, khớp `TabSegment` thật
          thay vì một khối đặc. */}
      {hasSegmentedControl && (
        <div className="bg-muted flex gap-1 rounded-lg p-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 flex-1 rounded-md" />
          ))}
        </div>
      )}
      <Skeleton className={`w-full rounded-lg ${chartHeight}`} />
    </div>
  );
}

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-lg space-y-4">
      {/* Thành viên tích cực — có ô chọn năm, biểu đồ sàn 300px */}
      <ChartCardSkeleton hasFilter />

      {/* Chi phí theo tháng — có dải chọn nhóm, biểu đồ 350px */}
      <ChartCardSkeleton hasSegmentedControl chartHeight="h-[350px]" />

      {/* Xu hướng điểm danh — biểu đồ 300px */}
      <ChartCardSkeleton />
    </div>
  );
}

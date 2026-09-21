import { Skeleton } from "@/components/ui/skeleton";

/**
 * Trang Cài đặt chạy 4 query song song (`getSettings`, danh sách sân, danh sách
 * hãng cầu, và `count(*)` trên `members`) mà trước đây KHÔNG có màn chờ nào:
 * bấm vào tab là trang đứng im, chỉ có cái spinner bé xíu trên icon điều hướng.
 *
 * Skeleton khớp bốn thẻ section thật theo đúng thứ tự `settings-client.tsx`
 * dựng ra: Chia tiền, Mặc định buổi chơi, Ngưỡng cảnh báo, Vận hành.
 */
function SectionCardSkeleton({
  rows = 3,
  hasGrid = false,
}: {
  rows?: number;
  hasGrid?: boolean;
}) {
  return (
    <div className="border-border bg-card space-y-4 rounded-xl border p-4 shadow-sm">
      {/* Đầu thẻ: ô icon tròn + tiêu đề */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
        <Skeleton className="h-5 w-40" />
      </div>
      {hasGrid ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: rows * 2 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-11 w-full rounded-xl" />
            </div>
          ))}
        </div>
      ) : (
        Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-11 w-full rounded-xl" />
          </div>
        ))
      )}
    </div>
  );
}

export default function Loading() {
  return (
    <div className="space-y-4 p-4 pb-24 lg:p-6">
      {/* Tiêu đề trang + mô tả */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>

      {/* Chia tiền: mức trừ tối thiểu + 3 thẻ nhóm + khối xem trước */}
      <SectionCardSkeleton rows={4} />
      {/* Mặc định buổi chơi: sân, hãng cầu, giờ, số sân, hạn vote, sĩ số */}
      <SectionCardSkeleton rows={3} hasGrid />
      {/* Ngưỡng cảnh báo: 3 ô */}
      <SectionCardSkeleton rows={2} hasGrid />
      {/* Vận hành */}
      <SectionCardSkeleton rows={2} />
    </div>
  );
}

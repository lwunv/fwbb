import { Skeleton } from "@/components/ui/skeleton";

/**
 * Khớp layout MeClient: thẻ hồ sơ (avatar + tên + hàng toggle "Sửa thông tin")
 * → thẻ giao diện (hàng 3 nút theme + hàng 3 nút ngôn ngữ) → thẻ 3 ô số liệu
 * (chi tháng / quỹ / còn nợ, mỗi ô icon tròn + số + nhãn). Giữ shape để không
 * nhảy layout khi data về. Trước đây skeleton có "thẻ đặt mật khẩu" không tồn
 * tại trong UI thật.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-lg space-y-4">
      {/* Thẻ hồ sơ */}
      <div className="border-border bg-card space-y-4 rounded-2xl border p-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
          <Skeleton className="h-6 w-40 flex-1" />
        </div>
        {/* Hàng toggle "Sửa thông tin" */}
        <div className="flex min-h-11 items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-4 rounded" />
            <Skeleton className="h-4 w-28" />
          </div>
          <Skeleton className="h-4 w-4 rounded" />
        </div>
      </div>

      {/* Thẻ giao diện: theme + ngôn ngữ (mỗi hàng 3 nút full-width) */}
      <div className="border-border bg-card space-y-4 rounded-2xl border p-4">
        <div className="flex gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[4.25rem] flex-1 rounded-xl" />
          ))}
        </div>
        <div className="flex gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[4.25rem] flex-1 rounded-xl" />
          ))}
        </div>
      </div>

      {/* Thẻ 3 ô số liệu */}
      <div className="border-border bg-card rounded-2xl border p-4">
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-1.5">
              <Skeleton className="h-10 w-10 rounded-full" />
              <Skeleton className="h-5 w-12" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

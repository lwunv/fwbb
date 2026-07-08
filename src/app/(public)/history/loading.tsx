import { Skeleton } from "@/components/ui/skeleton";

/**
 * Khớp layout HistoryClient: thẻ LỊCH (điều hướng tháng + hàng thứ + lưới ngày
 * 7×6) là phần chính, rồi thẻ chi tiết buổi (ngày + badge + phần "của bạn" +
 * 2 ô chi phí + danh sách người tham gia). Trước đây skeleton là 5 thẻ buổi
 * dọc → khác hẳn UI thật nên nhìn nhảy.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-lg space-y-4">
      {/* Thẻ lịch */}
      <div className="border-border bg-card rounded-xl border p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <Skeleton className="h-11 w-11 rounded-xl" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-11 w-11 rounded-xl" />
        </div>
        <div className="mb-1.5 grid grid-cols-7 gap-1.5">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="mx-auto h-4 w-6" />
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: 42 }).map((_, i) => (
            <Skeleton key={i} className="h-11 rounded-md" />
          ))}
        </div>
      </div>

      {/* Thẻ chi tiết buổi */}
      <div className="border-border bg-card space-y-4 rounded-2xl border p-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        {/* Phần "của bạn" */}
        <div className="border-border/60 space-y-3 rounded-lg border p-3">
          <Skeleton className="h-3 w-24" />
          <div className="flex gap-2">
            <Skeleton className="h-7 w-16 rounded-full" />
            <Skeleton className="h-7 w-16 rounded-full" />
          </div>
        </div>
        {/* 2 ô chi phí (chơi / nhậu) */}
        <div className="grid gap-2 sm:grid-cols-2">
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-20 rounded-lg" />
        </div>
        {/* Người tham gia */}
        <div className="space-y-2">
          <Skeleton className="h-3 w-28" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
              <Skeleton className="h-4 w-32 max-w-full flex-1" />
              <Skeleton className="h-5 w-12 shrink-0 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

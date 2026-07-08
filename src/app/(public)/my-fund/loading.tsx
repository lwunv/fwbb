import { Skeleton } from "@/components/ui/skeleton";

/**
 * Khớp layout MyFundClient: thẻ số dư lớn (icon + số 4xl + 2 cột đóng/trừ) →
 * thẻ nạp quỹ (tiêu đề + 2 nút mode + ô nhập) → thẻ lịch sử (header + danh
 * sách giao dịch). Giữ shape để không nhảy layout khi data về.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-lg space-y-4">
      {/* Thẻ số dư */}
      <div className="border-border bg-card rounded-2xl border p-5">
        <div className="mb-2 flex items-center gap-2">
          <Skeleton className="h-5 w-5 rounded" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="mb-2 h-10 w-44" />
        <Skeleton className="mb-6 h-4 w-28" />
        <div className="grid grid-cols-2 gap-4 border-t pt-4">
          {[0, 1].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-5 w-24" />
            </div>
          ))}
        </div>
      </div>

      {/* Thẻ nạp quỹ */}
      <div className="border-border bg-card space-y-3 rounded-2xl border p-4">
        <Skeleton className="h-5 w-36" />
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-14 rounded-xl" />
        </div>
        <Skeleton className="h-11 w-full rounded-xl" />
      </div>

      {/* Thẻ lịch sử giao dịch */}
      <div className="border-border bg-card overflow-hidden rounded-2xl border">
        <div className="flex items-center justify-between border-b p-4">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-10" />
        </div>
        <div className="divide-y">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-start justify-between gap-4 p-4">
              <div className="flex min-w-0 flex-1 gap-3">
                <Skeleton className="mt-0.5 h-5 w-5 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-40" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <Skeleton className="h-4 w-16 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

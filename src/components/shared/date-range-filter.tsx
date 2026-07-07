"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DateRangeFilterProps {
  /** YYYY-MM-DD hoặc null. State do caller sở hữu (URL/nuqs hoặc local). */
  from: string | null;
  to: string | null;
  onFromChange: (value: string | null) => void;
  onToChange: (value: string | null) => void;
  /** Handler xoá tuỳ biến; mặc định = clear cả 2. Caller thường dùng để kèm
   *  side-effect (vd reset về trang 1). */
  onClear?: () => void;
  /** Nhãn hiển thị phía trên control. */
  label?: string;
  /** aria-label cho từng ô + nút xoá (caller truyền từ i18n riêng). */
  fromAriaLabel?: string;
  toAriaLabel?: string;
  clearAriaLabel?: string;
  className?: string;
}

/**
 * Một control khoảng ngày GỘP làm một: `[từ] → [đến]` + nút xoá, chung một viền
 * → nhìn như một input range thay vì hai ô ngày rời.
 *
 * Dùng native `<input type="date">` (lịch OS đáng tin, mobile tốt, a11y sẵn).
 * Ràng buộc chéo `from ≤ to` qua `max`/`min`. Presentational thuần — không giữ
 * state, không biết i18n (nhãn truyền vào qua props) nên tái dùng được mọi nơi.
 */
export function DateRangeFilter({
  from,
  to,
  onFromChange,
  onToChange,
  onClear,
  label,
  fromAriaLabel,
  toAriaLabel,
  clearAriaLabel,
  className,
}: DateRangeFilterProps) {
  const clear =
    onClear ??
    (() => {
      onFromChange(null);
      onToChange(null);
    });

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {label && <span className="text-muted-foreground text-xs">{label}</span>}
      <div className="border-input bg-background focus-within:border-ring focus-within:ring-ring/40 flex h-9 w-fit max-w-full items-center gap-1.5 rounded-md border px-2 transition-colors focus-within:ring-2">
        <input
          type="date"
          aria-label={fromAriaLabel}
          value={from ?? ""}
          max={to ?? undefined}
          onChange={(e) => onFromChange(e.target.value || null)}
          className="w-[7.25rem] bg-transparent text-sm outline-none"
        />
        <span className="text-muted-foreground shrink-0 text-sm" aria-hidden>
          →
        </span>
        <input
          type="date"
          aria-label={toAriaLabel}
          value={to ?? ""}
          min={from ?? undefined}
          onChange={(e) => onToChange(e.target.value || null)}
          className="w-[7.25rem] bg-transparent text-sm outline-none"
        />
        {(from || to) && (
          <button
            type="button"
            aria-label={clearAriaLabel}
            title={clearAriaLabel}
            onClick={clear}
            className="text-muted-foreground hover:text-foreground shrink-0"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

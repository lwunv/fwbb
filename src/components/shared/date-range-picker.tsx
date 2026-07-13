"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isBefore,
  isSameDay,
  isSameMonth,
  isWithinInterval,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { vi } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface DateRangePickerProps {
  /** "YYYY-MM-DD" hoặc null. State do caller sở hữu (URL/nuqs hoặc local). */
  from: string | null;
  to: string | null;
  onFromChange: (v: string | null) => void;
  onToChange: (v: string | null) => void;
  /** Handler xoá tuỳ biến; mặc định clear cả 2. Caller thường kèm side-effect
   *  (vd reset về trang 1). */
  onClear?: () => void;
  /** Text trigger khi chưa chọn gì. */
  placeholder?: string;
  className?: string;
}

/** Thứ 2 → Chủ nhật (VN Mon-first) khớp `weekStartsOn: 1` bên dưới. */
const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

const YMD = "yyyy-MM-dd";
const DISPLAY = "dd/MM/yyyy";

/** Parse "YYYY-MM-DD" → Date local (null-safe). parseISO cho chuỗi date-only
 *  trả về nửa đêm local nên khớp với các Date sinh từ lịch bên dưới. */
function toDate(value: string | null): Date | null {
  return value ? parseISO(value) : null;
}

/**
 * Date-RANGE picker gọn: một nút trigger hiển thị dd/MM/yyyy, mở popover lịch
 * để chọn ngày bắt đầu + kết thúc bằng cách bấm trên lưới tháng (bấm start,
 * bấm end) thay vì hai ô `<input type="date">` rời.
 *
 * Presentational thuần: không giữ "selection" riêng, from/to lấy thẳng từ props
 * và emit ngay mỗi lần bấm (nuqs/parent là nguồn sự thật). Hiển thị dd/mm/yyyy,
 * phát ra "YYYY-MM-DD".
 */
export function DateRangePicker({
  from,
  to,
  onFromChange,
  onToChange,
  onClear,
  placeholder = "Khoảng ngày",
  className,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState<Date>(() =>
    startOfMonth(from ? parseISO(from) : new Date()),
  );
  const [pos, setPos] = useState({ top: 0, left: 0, width: 320 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const fromDate = toDate(from);
  const toDateVal = toDate(to);

  const clearAll = useCallback(() => {
    if (onClear) {
      onClear();
      return;
    }
    onFromChange(null);
    onToChange(null);
  }, [onClear, onFromChange, onToChange]);

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 16);
    let left = rect.left;
    if (left + width > window.innerWidth - 8)
      left = window.innerWidth - 8 - width;
    if (left < 8) left = 8;
    setPos({ top: rect.bottom + 6, left, width });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePos();

    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      )
        return;
      setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [open, updatePos]);

  function openPanel() {
    // Nhảy về tháng của `from` (hoặc tháng hiện tại) mỗi lần mở cho đỡ lạc.
    setMonth(startOfMonth(fromDate ?? new Date()));
    setOpen(true);
  }

  function handleDayClick(day: Date) {
    const ymd = format(day, YMD);
    const hasRange = fromDate !== null && toDateVal !== null;
    // Chưa có start, hoặc đã đủ cả 2 → bắt đầu chọn lại từ đầu.
    if (fromDate === null || hasRange) {
      onFromChange(ymd);
      onToChange(null);
      return;
    }
    // Đang có start, chưa có end.
    if (isBefore(day, fromDate)) {
      // Bấm trước start → coi như start mới.
      onFromChange(ymd);
      onToChange(null);
      return;
    }
    // Bấm sau/bằng start → chốt end + tự đóng.
    onToChange(ymd);
    setOpen(false);
  }

  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
  });

  const hasValue = fromDate !== null;
  const triggerLabel =
    fromDate && toDateVal
      ? `${format(fromDate, DISPLAY)} → ${format(toDateVal, DISPLAY)}`
      : fromDate
        ? format(fromDate, DISPLAY)
        : placeholder;

  return (
    <div className={cn("relative w-full", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        className={cn(
          "border-input bg-card flex h-11 w-full items-center gap-2 rounded-xl border px-4 text-sm shadow-sm transition-colors",
          "hover:border-primary/50 focus-visible:border-ring focus-visible:ring-ring/40 outline-none focus-visible:ring-2",
          open && "border-primary",
        )}
      >
        <Calendar className="text-muted-foreground h-4 w-4 shrink-0" />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-left",
            !hasValue && "text-muted-foreground",
          )}
        >
          {triggerLabel}
        </span>
        {hasValue && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Xoá khoảng ngày"
            onClick={(e) => {
              e.stopPropagation();
              clearAll();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                clearAll();
              }
            }}
            className="text-muted-foreground hover:text-foreground -mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
          >
            <X className="h-4 w-4" />
          </span>
        )}
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              width: pos.width,
            }}
            className="bg-popover animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 z-[9999] rounded-xl border p-3 shadow-lg"
          >
            {/* Điều hướng tháng */}
            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 min-w-11"
                onClick={() => setMonth((m) => addMonths(m, -1))}
                aria-label="Tháng trước"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <p className="text-sm font-semibold capitalize">
                {format(month, "MMMM yyyy", { locale: vi })}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 min-w-11"
                onClick={() => setMonth((m) => addMonths(m, 1))}
                aria-label="Tháng sau"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>

            {/* Lưới ngày */}
            <div className="mt-2 grid grid-cols-7 gap-0.5">
              {WEEKDAYS.map((w) => (
                <div
                  key={w}
                  className="text-muted-foreground py-1 text-center text-xs font-medium"
                >
                  {w}
                </div>
              ))}
              {days.map((d) => {
                const inMonth = isSameMonth(d, month);
                const isStart = fromDate !== null && isSameDay(d, fromDate);
                const isEnd = toDateVal !== null && isSameDay(d, toDateVal);
                const isBetween =
                  fromDate !== null &&
                  toDateVal !== null &&
                  isWithinInterval(d, { start: fromDate, end: toDateVal }) &&
                  !isStart &&
                  !isEnd;
                const isEdge = isStart || isEnd;
                return (
                  <button
                    key={format(d, YMD)}
                    type="button"
                    onClick={() => handleDayClick(d)}
                    className={cn(
                      "flex min-h-10 items-center justify-center rounded-lg text-sm transition-colors",
                      !inMonth && "text-muted-foreground/40",
                      !isEdge && !isBetween && "hover:bg-muted",
                      isBetween && "bg-primary/15",
                      isEdge &&
                        "bg-primary text-primary-foreground font-semibold",
                    )}
                  >
                    {format(d, "d")}
                  </button>
                );
              })}
            </div>

            {/* Footer: Xoá (trái) · Xong (phải) */}
            <div className="mt-2 flex items-center justify-between border-t pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAll}
                disabled={!hasValue}
              >
                Xoá
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setOpen(false)}
              >
                Xong
              </Button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

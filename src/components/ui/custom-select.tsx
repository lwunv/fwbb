"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { SearchInput } from "@/components/shared/search-input";

export interface SelectOption {
  value: string;
  label: string;
  /** Optional right-aligned info (price, count, badge…) — primary color,
   *  shown on the right side of the row. Đồng bộ style với CourtSelector. */
  rightLabel?: string;
}

// Khoảng cách giữa trigger và dropdown.
const DROPDOWN_GAP = 4;
// Đệm tới mép màn hình — mobile hay bị thanh điều hướng/notch che, và ô tìm
// kiếm tự focus làm bàn phím ảo che thêm phần đáy.
const VIEWPORT_PADDING = 8;
// Chiều cao mặc định khi đủ chỗ — khớp `max-h-96` (24rem) vốn có trên list,
// giữ nguyên giao diện mặc định trên desktop/khi dropdown có nhiều chỗ trống.
const DEFAULT_DROPDOWN_MAX_HEIGHT = 384;
// Sàn tối thiểu khi cả trên lẫn dưới đều chật (vd landscape + bàn phím ảo) —
// vẫn cho thấy vài dòng cuộn được thay vì co về 0.
const MIN_DROPDOWN_MAX_HEIGHT = 120;

interface CustomSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Hidden input name for form submission */
  name?: string;
  /** Show a search box at the top of the dropdown when option count exceeds this. */
  searchable?: boolean;
  searchPlaceholder?: string;
}

export function CustomSelect({
  options,
  value,
  onChange,
  placeholder,
  disabled,
  className,
  name,
  searchable,
  searchPlaceholder,
}: CustomSelectProps) {
  const tCommon = useTranslations("common");
  const usedPlaceholder = placeholder ?? tCommon("selectPlaceholder");
  const usedSearchPlaceholder =
    searchPlaceholder ?? tCommon("searchPlaceholder");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxHeight: number;
  }>({ top: 0, left: 0, width: 0, maxHeight: DEFAULT_DROPDOWN_MAX_HEIGHT });

  const filteredOptions = useMemo(() => {
    if (!searchable) return options;
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query, searchable]);

  // Focus the search input when the dropdown opens. Don't reset `query` from
  // an effect — that triggers cascading renders. Instead, callers that close
  // the dropdown via `closeAndReset` below pass the reset through `setQuery`
  // synchronously, so `query` is already cleared by the next render.
  useEffect(() => {
    if (open && searchable) {
      const id = setTimeout(() => searchInputRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
  }, [open, searchable]);

  const closeAndReset = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    // `position: fixed` qua portal nên phần vượt đáy màn hình không cuộn tới
    // được — tính khoảng trống thật hai phía, lật lên trên khi dưới không đủ
    // mà trên rộng hơn, và luôn giới hạn max-height theo khoảng trống thật
    // (trừ đệm) để list tự cuộn bên trong thay vì tràn khỏi viewport.
    const spaceBelow =
      window.innerHeight - rect.bottom - DROPDOWN_GAP - VIEWPORT_PADDING;
    const spaceAbove = rect.top - DROPDOWN_GAP - VIEWPORT_PADDING;
    const openUpward =
      spaceBelow < DEFAULT_DROPDOWN_MAX_HEIGHT && spaceAbove > spaceBelow;
    const available = openUpward ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(
      MIN_DROPDOWN_MAX_HEIGHT,
      Math.min(DEFAULT_DROPDOWN_MAX_HEIGHT, available),
    );
    const top = openUpward ? undefined : rect.bottom + DROPDOWN_GAP;
    const bottom = openUpward
      ? window.innerHeight - rect.top + DROPDOWN_GAP
      : undefined;

    setPos({ top, bottom, left: rect.left, width: rect.width, maxHeight });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePos();

    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      )
        return;
      closeAndReset();
    }

    function handleScroll() {
      updatePos();
    }

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", updatePos);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [open, updatePos, closeAndReset]);

  const selected = options.find((o) => o.value === value);

  return (
    <div className={cn("relative", className)}>
      {name && <input type="hidden" name={name} value={value} />}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          if (open) closeAndReset();
          else setOpen(true);
        }}
        className={cn(
          "bg-card hover:border-primary/50 flex h-11 w-full items-center justify-between rounded-xl border px-4 text-base transition-colors",
          "disabled:pointer-events-none disabled:opacity-50",
          open && "border-primary",
        )}
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected?.label ?? usedPlaceholder}
        </span>
        <ChevronDown
          className={cn(
            "text-muted-foreground h-4 w-4 shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{
              position: "fixed",
              top: pos.top,
              bottom: pos.bottom,
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
            }}
            className="bg-popover animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 z-[9999] flex flex-col overflow-hidden rounded-xl border shadow-lg"
          >
            {searchable && (
              <div className="shrink-0 border-b p-2">
                <SearchInput
                  ref={searchInputRef}
                  value={query}
                  onChange={setQuery}
                  placeholder={usedSearchPlaceholder}
                />
              </div>
            )}
            <div className="max-h-96 min-h-0 flex-1 overflow-auto py-1">
              {filteredOptions.map((option) => {
                const isSelected = option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      onChange(option.value);
                      closeAndReset();
                    }}
                    className={cn(
                      "mx-1 flex items-center justify-between gap-3 rounded-lg px-4 py-3 text-left text-base transition-colors first:mt-1 last:mb-1",
                      isSelected
                        ? "bg-primary/15 font-medium"
                        : "hover:bg-muted/50",
                    )}
                    style={{ width: "calc(100% - 0.5rem)" }}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {option.label}
                    </span>
                    {option.rightLabel && (
                      <span className="text-primary shrink-0 text-sm font-medium">
                        {option.rightLabel}
                      </span>
                    )}
                  </button>
                );
              })}
              {filteredOptions.length === 0 && (
                <p className="text-muted-foreground px-4 py-3 text-center text-sm">
                  {query ? "Không tìm thấy" : "Không có lựa chọn"}
                </p>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

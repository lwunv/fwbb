"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { SearchInput } from "@/components/shared/search-input";

export interface SelectOption {
  value: string;
  label: string;
  /** Optional right-aligned info (price, count, badge…) — primary color,
   *  shown on the right side of the row. Đồng bộ style với CourtSelector. */
  rightLabel?: string;
}

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
  placeholder = "Chọn...",
  disabled,
  className,
  name,
  searchable,
  searchPlaceholder = "Tìm...",
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

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
    setPos({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    });
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
          "bg-card hover:border-primary/50 flex h-[42px] w-full items-center justify-between rounded-xl border px-4 text-base transition-colors",
          "disabled:pointer-events-none disabled:opacity-50",
          open && "border-primary",
        )}
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected?.label ?? placeholder}
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
              left: pos.left,
              width: pos.width,
            }}
            className="bg-popover animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 z-[9999] overflow-hidden rounded-xl border shadow-lg"
          >
            {searchable && (
              <div className="border-b p-2">
                <SearchInput
                  ref={searchInputRef}
                  value={query}
                  onChange={setQuery}
                  placeholder={searchPlaceholder}
                />
              </div>
            )}
            <div className="max-h-96 overflow-auto py-1">
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

"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
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
}

export function CustomSelect({
  options,
  value,
  onChange,
  placeholder = "Chọn...",
  disabled,
  className,
  name,
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

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
      setOpen(false);
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
  }, [open, updatePos]);

  const selected = options.find((o) => o.value === value);

  return (
    <div className={cn("relative", className)}>
      {name && <input type="hidden" name={name} value={value} />}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className={cn(
          "bg-background flex h-12 w-full items-center justify-between rounded-xl border px-4 text-base transition-colors",
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
            <div className="max-h-60 overflow-auto py-1">
              {options.map((option) => {
                const isSelected = option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-3 text-left text-base transition-colors",
                      isSelected
                        ? "text-primary font-medium"
                        : "hover:bg-muted/50",
                    )}
                  >
                    <span className="flex-1 truncate">{option.label}</span>
                    {isSelected && (
                      <Check className="text-primary h-4 w-4 shrink-0" />
                    )}
                  </button>
                );
              })}
              {options.length === 0 && (
                <p className="text-muted-foreground px-4 py-3 text-center text-sm">
                  Không có lựa chọn
                </p>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

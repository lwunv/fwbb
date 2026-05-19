"use client";

import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface NumberStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  /** Hidden input name for form submission */
  name?: string;
  /** "raw" = plain integer input (default). "vnd" = text input với
   *  thousand-separator format vi-VN (e.g., 100.000) — chỉ chấp nhận digits.
   *  Dùng cho money input để admin dễ đọc số tiền lớn. */
  displayFormat?: "raw" | "vnd";
  autoFocus?: boolean;
  /** Override input width — default w-14 (raw) hoặc flex-1 (vnd-wide). */
  inputClassName?: string;
}

export function NumberStepper({
  value,
  onChange,
  min = 0,
  max = Infinity,
  step = 1,
  disabled,
  className,
  name,
  displayFormat = "raw",
  autoFocus,
  inputClassName,
}: NumberStepperProps) {
  function set(next: number) {
    const clamped = Math.max(min, Math.min(max, next));
    if (clamped !== value) onChange(clamped);
  }

  const isVnd = displayFormat === "vnd";

  return (
    <div
      className={cn(
        "bg-background inline-flex h-11 items-stretch overflow-hidden rounded-xl border",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      {name && <input type="hidden" name={name} value={value} />}
      <button
        type="button"
        disabled={disabled || value <= min}
        onClick={() => set(value - step)}
        className="hover:bg-accent flex w-11 shrink-0 items-center justify-center border-r transition-colors disabled:opacity-40"
        aria-label={`Giảm ${step.toLocaleString("vi-VN")}`}
      >
        <Minus className="h-4 w-4" />
      </button>
      {isVnd ? (
        <input
          type="text"
          inputMode="numeric"
          value={value > 0 ? value.toLocaleString("vi-VN") : ""}
          disabled={disabled}
          autoFocus={autoFocus}
          placeholder="0"
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "");
            const n = digits ? parseInt(digits, 10) : 0;
            if (!Number.isNaN(n)) set(n);
          }}
          className={cn(
            "min-w-0 flex-1 border-0 bg-transparent py-0 text-center text-base font-bold tabular-nums outline-none focus-visible:ring-0",
            inputClassName,
          )}
        />
      ) : (
        <input
          type="number"
          min={min}
          max={max === Infinity ? undefined : max}
          step={step}
          value={value}
          disabled={disabled}
          autoFocus={autoFocus}
          onChange={(e) => {
            const raw = parseInt(e.target.value, 10);
            if (!Number.isNaN(raw)) set(raw);
          }}
          className={cn(
            "w-14 min-w-14 flex-1 [appearance:textfield] border-0 bg-transparent py-0 text-center text-base font-bold tabular-nums outline-none focus-visible:ring-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
            inputClassName,
          )}
        />
      )}
      <button
        type="button"
        disabled={disabled || value >= max}
        onClick={() => set(value + step)}
        className="hover:bg-accent flex w-11 shrink-0 items-center justify-center border-l transition-colors disabled:opacity-40"
        aria-label={`Tăng ${step.toLocaleString("vi-VN")}`}
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

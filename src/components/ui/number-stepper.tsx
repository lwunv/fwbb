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
}: NumberStepperProps) {
  function set(next: number) {
    const clamped = Math.max(min, Math.min(max, next));
    if (clamped !== value) onChange(clamped);
  }

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
        className="hover:bg-accent flex w-11 items-center justify-center border-r transition-colors disabled:opacity-40"
      >
        <Minus className="h-4 w-4" />
      </button>
      <input
        type="number"
        min={min}
        max={max === Infinity ? undefined : max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const raw = parseInt(e.target.value, 10);
          if (!Number.isNaN(raw)) set(raw);
        }}
        className="w-14 min-w-14 flex-1 [appearance:textfield] border-0 bg-transparent py-0 text-center text-base font-bold tabular-nums outline-none focus-visible:ring-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        disabled={disabled || value >= max}
        onClick={() => set(value + step)}
        className="hover:bg-accent flex w-11 items-center justify-center border-l transition-colors disabled:opacity-40"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

const STARS = [1, 2, 3, 4, 5] as const;

/**
 * Chọn 1 đến 5 sao cho một tiêu chí. Một nhóm radio thật cho trình đọc màn
 * hình: chỉ một ngôi nhận Tab (ngôi đang chọn, hoặc ngôi đầu khi chưa chọn),
 * mũi tên đổi điểm và dời tiêu điểm theo. Mỗi ngôi là vùng chạm 44px.
 */
export function StarInput({
  label,
  value,
  onChange,
  invalid = false,
}: {
  label: string;
  /** 0 = chưa chọn. */
  value: number;
  onChange: (value: number) => void;
  invalid?: boolean;
}) {
  const t = useTranslations("venueReviews");
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function pick(n: number) {
    const next = Math.min(5, Math.max(1, n));
    onChange(next);
    refs.current[next - 1]?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const step: Record<string, number> = {
      ArrowRight: 1,
      ArrowUp: 1,
      ArrowLeft: -1,
      ArrowDown: -1,
    };
    if (e.key in step) {
      e.preventDefault();
      pick(value === 0 ? 1 : value + step[e.key]);
    } else if (e.key === "Home") {
      e.preventDefault();
      pick(1);
    } else if (e.key === "End") {
      e.preventDefault();
      pick(5);
    }
  }

  const focusable = value === 0 ? 1 : value;

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <span className="min-w-0 text-base font-medium break-words">{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        aria-invalid={invalid || undefined}
        className="flex"
      >
        {STARS.map((n) => {
          const filled = n <= value;
          return (
            <motion.button
              key={n}
              ref={(el) => {
                refs.current[n - 1] = el;
              }}
              type="button"
              role="radio"
              aria-checked={value === n}
              aria-label={t("starsAria", { count: n })}
              tabIndex={n === focusable ? 0 : -1}
              onClick={() => pick(n)}
              onKeyDown={onKeyDown}
              whileTap={{ scale: 0.85 }}
              className="focus-visible:ring-ring/50 inline-flex size-11 items-center justify-center rounded-xl outline-none focus-visible:ring-3"
            >
              <Star
                aria-hidden
                className={cn(
                  "size-7 transition-colors",
                  filled
                    ? "fill-primary text-primary"
                    : invalid
                      ? "text-destructive/60"
                      : "text-muted-foreground/50",
                )}
              />
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

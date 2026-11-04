"use client";

import { cn } from "@/lib/utils";
import { TAP_TOOLTIP_CLASS, useTapTooltip } from "./use-tap-tooltip";

/**
 * Tên member một dòng, bị cắt "..." khi chật. Chạm hoặc rê chuột vào thì hiện
 * đủ tên trong bong bóng (cùng kiểu với nhãn trình độ). Tên đã hiện đủ thì
 * không bật bong bóng, khỏi làm phiền người chạm nhầm.
 */
export function TruncatedName({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const { show, tipId, rootRef, triggerRef, tipRef, triggerProps } =
    useTapTooltip<HTMLButtonElement>((el) => el.scrollWidth > el.clientWidth);

  return (
    <span ref={rootRef} className="flex min-w-0">
      <button
        ref={triggerRef}
        type="button"
        {...triggerProps}
        className={cn("min-w-0 truncate text-left", className)}
      >
        {name}
      </button>
      {show && (
        <span
          ref={tipRef}
          id={tipId}
          role="tooltip"
          style={{ opacity: 0 }}
          className={cn(TAP_TOOLTIP_CLASS, "text-sm leading-5")}
        >
          {name}
        </span>
      )}
    </span>
  );
}

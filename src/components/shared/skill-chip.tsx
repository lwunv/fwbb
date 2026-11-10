"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { SKILL_BADGE_CLASS, type SkillLevel } from "@/lib/skill-level";
import { TAP_TOOLTIP_CLASS, useTapTooltip } from "./use-tap-tooltip";

const CHIP_BASE =
  "inline-flex shrink-0 items-center rounded-md border px-1.5 py-0 align-middle text-[11px] leading-5 font-bold";

/**
 * Nhãn trình độ cỡ nhỏ, dán cạnh tên member trong danh sách vote.
 *
 * Chưa khai thì KHÔNG render gì (không phải render một ô trống): phần lớn
 * member sẽ không khai, mà danh sách vote là chỗ chật, một chỗ trống trên mỗi
 * dòng là tốn chỗ vô ích.
 */
export function SkillChip({
  level,
  className,
  withBlurb = false,
}: {
  level: SkillLevel | null | undefined;
  className?: string;
  /**
   * Cho phép XEM câu mô tả vui của mức đó, chứ không hiện sẵn. Câu mô tả dài
   * hơn cả tên người, để nằm trên dòng thì hàng tên bị vỡ hoặc cắt cụt trên
   * điện thoại. Nó chỉ nổi lên khi rê chuột hoặc chạm vào nhãn, nên không
   * chiếm một pixel nào trong bố cục.
   */
  withBlurb?: boolean;
}) {
  const t = useTranslations("me");
  const { show, tipId, rootRef, triggerRef, tipRef, triggerProps } =
    useTapTooltip<HTMLButtonElement>();

  if (!level) return null;

  if (!withBlurb) {
    return (
      <span className={cn(CHIP_BASE, SKILL_BADGE_CLASS[level], className)}>
        {t(`skillShort.${level}`)}
      </span>
    );
  }

  return (
    <span
      ref={rootRef}
      className={cn("relative inline-flex shrink-0 align-middle", className)}
    >
      <button
        ref={triggerRef}
        type="button"
        {...triggerProps}
        className={cn(CHIP_BASE, SKILL_BADGE_CLASS[level], "cursor-help")}
      >
        {t(`skillShort.${level}`)}
      </button>
      {show && (
        <span
          ref={tipRef}
          id={tipId}
          role="tooltip"
          style={{ opacity: 0 }}
          className={TAP_TOOLTIP_CLASS}
        >
          {t(`skillBlurb.${level}`)}
        </span>
      )}
    </span>
  );
}

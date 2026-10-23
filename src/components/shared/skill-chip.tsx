"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { SKILL_BADGE_CLASS, type SkillLevel } from "@/lib/skill-level";

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
   * Hiện kèm câu mô tả vui của mức đó. Bật ở màn quản lý thành viên, nơi admin
   * cần đọc được ý nghĩa; TẮT ở danh sách vote trang chủ vì chỗ đó phải gọn.
   */
  withBlurb?: boolean;
}) {
  const t = useTranslations("me");
  if (!level) return null;

  const chip = (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md border px-1.5 py-0 align-middle text-[11px] leading-5 font-bold",
        SKILL_BADGE_CLASS[level],
        !withBlurb && className,
      )}
    >
      {t(`skillShort.${level}`)}
    </span>
  );

  if (!withBlurb) return chip;

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
      {chip}
      {/* `truncate` để câu dài không đẩy vỡ hàng tên trên màn hình hẹp. */}
      <span className="text-muted-foreground truncate text-[10px] leading-4 font-normal">
        {t(`skillBlurb.${level}`)}
      </span>
    </span>
  );
}

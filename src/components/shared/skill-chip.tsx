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
}: {
  level: SkillLevel | null | undefined;
  className?: string;
}) {
  const t = useTranslations("me");
  if (!level) return null;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md border px-1.5 py-0 align-middle text-[11px] leading-5 font-bold",
        SKILL_BADGE_CLASS[level],
        className,
      )}
    >
      {t(`skillShort.${level}`)}
    </span>
  );
}

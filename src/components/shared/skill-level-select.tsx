"use client";

import { useTranslations } from "next-intl";
import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  SKILL_BADGE_CLASS,
  SKILL_LEVELS,
  parseSkillLevel,
} from "@/lib/skill-level";
import { TAP_TOOLTIP_CLASS, useTapTooltip } from "./use-tap-tooltip";

/**
 * Dropdown trình độ GỘP luôn chip (yêu cầu user 6/11/2026, thay cặp "chip +
 * ô chọn" cạnh nhau ở /admin/members):
 * - Nút mang màu của mức đang chọn; rê chuột vào thì hiện câu mô tả. Chỉ bắt
 *   rê chuột, KHÔNG bắt chạm: chạm là để mở menu.
 * - Mỗi mức trong menu có màu riêng. Desktop rê vào hiện mô tả (`title`);
 *   mobile không có rê nên mô tả nằm ngay dòng phụ dưới tên mức.
 * `value` "" = chưa khai.
 */
export function SkillLevelSelect({
  value,
  onChange,
  ariaLabelPrefix,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Ví dụ "Đổi trình độ": tên đọc của nút = "<prefix>: <mức>". */
  ariaLabelPrefix?: string;
  className?: string;
}) {
  const t = useTranslations("me");
  const level = parseSkillLevel(value);
  const label = level ? t(`skillShort.${level}`) : t("skillNone");
  const { show, tipId, rootRef, triggerRef, tipRef, triggerProps } =
    useTapTooltip<HTMLButtonElement>();

  return (
    <span ref={rootRef} className={cn("relative inline-flex", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={triggerRef}
          aria-label={ariaLabelPrefix ? `${ariaLabelPrefix}: ${label}` : label}
          aria-describedby={show ? tipId : undefined}
          onPointerEnter={level ? triggerProps.onPointerEnter : undefined}
          onPointerLeave={triggerProps.onPointerLeave}
          className={cn(
            "inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-sm font-bold transition-colors",
            level
              ? SKILL_BADGE_CLASS[level]
              : "border-border text-muted-foreground bg-background font-medium",
          )}
        >
          {label}
          <ChevronDown className="h-4 w-4 opacity-70" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {(["", ...SKILL_LEVELS] as const).map((lv) => {
            const blurb = lv ? t(`skillBlurb.${lv}`) : undefined;
            const selected = lv === (level ?? "");
            return (
              <DropdownMenuItem
                key={lv || "none"}
                title={blurb}
                onClick={() => onChange(lv)}
                className="items-start py-2"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    className={cn(
                      "self-start rounded-md border px-1.5 text-sm leading-6 font-bold",
                      lv
                        ? SKILL_BADGE_CLASS[lv]
                        : "border-border text-muted-foreground font-medium",
                    )}
                  >
                    {lv ? t(`skillShort.${lv}`) : t("skillNone")}
                  </span>
                  {blurb && (
                    <span className="text-muted-foreground text-sm sm:hidden">
                      {blurb}
                    </span>
                  )}
                </span>
                {selected && (
                  <Check className="text-primary mt-1 h-4 w-4 shrink-0" />
                )}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      {show && level && (
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

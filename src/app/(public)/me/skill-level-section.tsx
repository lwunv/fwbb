"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Gauge } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fireAction } from "@/lib/optimistic-action";
import { updateMySkillLevel } from "@/actions/members";
import {
  SKILL_LEVELS,
  SKILL_BADGE_CLASS,
  type SkillLevel,
} from "@/lib/skill-level";

interface Props {
  /** Mức đang khai, `null` nghĩa là chưa khai. */
  current: SkillLevel | null;
}

/**
 * Member tự chọn trình độ. Năm mức, mỗi mức một thẻ màu riêng.
 *
 * Khối gập lại mặc định, giống khối "Sửa thông tin cá nhân" ngay trên: trang
 * /me là trang người ta vào để xem tiền, còn trình độ thì chọn một lần rồi
 * thôi, không đáng chiếm nửa màn hình mỗi lần mở. Mức đang chọn hiện ngay trên
 * thanh tiêu đề nên không cần mở ra mới biết mình đang khai gì.
 *
 * Bấm là lưu ngay chứ không có nút Lưu: đây là một lựa chọn đơn, sai thì bấm
 * lại cái khác. Bấm đúng mức đang chọn thì bỏ khai, vì người dùng sẽ thử đúng
 * cách đó và không có nút "xoá" nào hợp lý hơn.
 */
export function SkillLevelSection({ current }: Props) {
  const t = useTranslations("me");
  const [expanded, setExpanded] = useState(false);
  const [picked, setPicked] = useState<SkillLevel | null>(current);

  // Server trả giá trị mới về sau revalidate (hoặc member sửa ở tab khác) →
  // bám theo prop, cùng mẫu với các khối khác của trang này.
  const [prev, setPrev] = useState<SkillLevel | null>(current);
  if (current !== prev) {
    setPrev(current);
    setPicked(current);
  }

  function choose(level: SkillLevel) {
    const before = picked;
    const next = picked === level ? null : level;
    setPicked(next);
    fireAction(
      () => updateMySkillLevel(next ?? ""),
      () => setPicked(before),
    );
  }

  return (
    <Card>
      <CardContent className="p-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="hover:bg-accent/50 flex min-h-11 w-full items-center gap-2 rounded-lg px-1 text-left transition-colors"
        >
          <Gauge className="text-primary h-5 w-5 shrink-0" />
          <span className="font-semibold">{t("skillTitle")}</span>
          <span
            className={cn(
              "ml-auto shrink-0 rounded-lg border px-2 py-0.5 text-xs font-bold",
              picked
                ? SKILL_BADGE_CLASS[picked]
                : "text-muted-foreground border-dashed",
            )}
          >
            {picked ? t(`skillShort.${picked}`) : t("skillNone")}
          </span>
          <ChevronDown
            className={cn(
              "text-muted-foreground h-4 w-4 shrink-0 transition-transform",
              expanded && "rotate-180",
            )}
          />
        </button>

        {expanded && (
          <div className="mt-2 space-y-1.5">
            <p className="text-muted-foreground px-1 text-xs">
              {t("skillHint")}
            </p>
            {SKILL_LEVELS.map((level) => {
              const active = picked === level;
              return (
                <button
                  key={level}
                  type="button"
                  onClick={() => choose(level)}
                  aria-pressed={active}
                  className={cn(
                    "flex min-h-11 w-full flex-wrap items-center gap-x-2 rounded-lg border px-2.5 py-1 text-left transition-all",
                    SKILL_BADGE_CLASS[level],
                    active
                      ? "ring-primary ring-2"
                      : "opacity-75 hover:opacity-100",
                  )}
                >
                  <span className="text-sm font-bold">
                    {t(`skillShort.${level}`)}
                  </span>
                  <span className="text-xs leading-tight opacity-90">
                    {t(`skillBlurb.${level}`)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

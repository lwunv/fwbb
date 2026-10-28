"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { SKILL_BADGE_CLASS, type SkillLevel } from "@/lib/skill-level";

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
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const tipId = useId();
  const show = pinned || hovered;

  // Chạm ra ngoài thì bỏ ghim. Trên điện thoại không có động tác "rê chuột
  // ra", nếu không tự đóng thì chạm vài nhãn là màn hình đầy bong bóng chữ.
  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setPinned(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [pinned]);

  // Đặt bong bóng bằng toạ độ màn hình (`position: fixed`) thay vì absolute
  // theo nhãn. Cả ba chỗ dùng nhãn này đều nằm trong khung `overflow-hidden`
  // (danh sách vote bo góc, bảng member cuộn ngang), nên bong bóng absolute
  // của dòng CUỐI sẽ bị cắt mất. Ghi thẳng style vào DOM, không qua state, để
  // khỏi render thêm một vòng chỉ vì đo đạc.
  useLayoutEffect(() => {
    if (!show) return;
    const btn = btnRef.current;
    const tip = tipRef.current;
    if (!btn || !tip) return;
    const place = () => {
      const b = btn.getBoundingClientRect();
      const margin = 8;
      const left = Math.max(
        margin,
        Math.min(b.left, window.innerWidth - tip.offsetWidth - margin),
      );
      tip.style.top = `${b.bottom + 4}px`;
      tip.style.left = `${left}px`;
      tip.style.opacity = "1";
    };
    place();
    // `true`: bắt cả scroll của khung cuộn bên trong, không chỉ của cửa sổ.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [show]);

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
        ref={btnRef}
        type="button"
        aria-expanded={show}
        aria-describedby={show ? tipId : undefined}
        // Nhãn hay nằm trong một hàng bấm được (mở hồ sơ member). Chặn nổi bọt
        // để chạm vào nhãn chỉ xem mô tả, không mở luôn hồ sơ.
        onClick={(e) => {
          e.stopPropagation();
          setPinned((v) => !v);
        }}
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse") setHovered(true);
        }}
        onPointerLeave={() => setHovered(false)}
        className={cn(CHIP_BASE, SKILL_BADGE_CLASS[level], "cursor-help")}
      >
        {t(`skillShort.${level}`)}
      </button>
      {show && (
        <span
          ref={tipRef}
          id={tipId}
          role="tooltip"
          // opacity 0 cho tới khi đo xong, nếu không nó loé một nhịp ở góc
          // trái trên màn hình rồi mới nhảy về đúng chỗ.
          style={{ opacity: 0 }}
          className="bg-popover text-popover-foreground border-border/60 pointer-events-none fixed top-0 left-0 z-50 max-w-[70vw] rounded-md border px-2 py-1 text-[11px] leading-4 font-normal whitespace-normal shadow-md sm:max-w-xs"
        >
          {t(`skillBlurb.${level}`)}
        </span>
      )}
    </span>
  );
}

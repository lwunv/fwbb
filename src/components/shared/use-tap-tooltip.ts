"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

/**
 * Bong bóng chữ mở bằng rê chuột (máy tính) hoặc chạm (điện thoại), dùng
 * chung cho nhãn trình độ và tên member bị cắt cụt.
 *
 * `canOpen` cho phép từ chối mở (vd tên đã hiện đủ thì không cần bong bóng).
 */
export function useTapTooltip<
  TTrigger extends HTMLElement,
  TRoot extends HTMLElement = HTMLSpanElement,
>(canOpen: (trigger: TTrigger) => boolean = () => true) {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const rootRef = useRef<TRoot>(null);
  const triggerRef = useRef<TTrigger>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const tipId = useId();
  const show = pinned || hovered;

  // Chạm ra ngoài thì bỏ ghim. Trên điện thoại không có động tác "rê chuột
  // ra", nếu không tự đóng thì chạm vài chỗ là màn hình đầy bong bóng chữ.
  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setPinned(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [pinned]);

  // Đặt bong bóng bằng toạ độ màn hình (`position: fixed`) thay vì absolute
  // theo phần tử. Các chỗ dùng đều nằm trong khung `overflow-hidden` (danh
  // sách vote bo góc, bảng member cuộn ngang), nên bong bóng absolute của
  // dòng CUỐI sẽ bị cắt mất. Ghi thẳng style vào DOM, không qua state, để
  // khỏi render thêm một vòng chỉ vì đo đạc.
  useLayoutEffect(() => {
    if (!show) return;
    const trigger = triggerRef.current;
    const tip = tipRef.current;
    if (!trigger || !tip) return;
    const place = () => {
      const b = trigger.getBoundingClientRect();
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

  const allowed = () => !!triggerRef.current && canOpen(triggerRef.current);

  const triggerProps = {
    "aria-expanded": show,
    "aria-describedby": show ? tipId : undefined,
    // Phần tử hay nằm trong một hàng bấm được (mở hồ sơ member). Chặn nổi bọt
    // để chạm vào chỉ xem bong bóng, không mở luôn hồ sơ.
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      setPinned((v) => (v ? false : allowed()));
    },
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse" && allowed()) setHovered(true);
    },
    onPointerLeave: () => setHovered(false),
  };

  return { show, tipId, rootRef, triggerRef, tipRef, triggerProps };
}

/** Class chung của bong bóng. Mờ hẳn tới khi đo xong để khỏi loé ở góc. */
export const TAP_TOOLTIP_CLASS =
  "bg-popover text-popover-foreground border-border/60 pointer-events-none fixed top-0 left-0 z-50 max-w-[70vw] rounded-md border px-2 py-1 text-[11px] leading-4 font-normal whitespace-normal shadow-md sm:max-w-xs";

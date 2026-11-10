"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Phần màn hình người dùng đang thấy được, tính bằng px. */
export type VisualViewportBox = {
  /** Chiều cao vùng thấy được (đã trừ bàn phím ảo). */
  height: number;
  /** Khoảng từ đáy vùng thấy được tới đáy cửa sổ, tức phần bàn phím che. */
  bottomInset: number;
};

/** Chuỗi để `useSyncExternalStore` so bằng `===`, không tạo object mới mỗi lần đọc. */
function snapshot(): string {
  const vv = window.visualViewport;
  if (!vv) return "";
  const inset = Math.max(
    0,
    Math.round(window.innerHeight - vv.height - vv.offsetTop),
  );
  return `${Math.round(vv.height)}:${inset}`;
}

const serverSnapshot = () => "";

/**
 * Theo dõi `window.visualViewport` khi `active`. Trên iOS bàn phím ảo không
 * làm co `100dvh` hay cửa sổ, nên thứ gì dính đáy (`bottom: 0`) sẽ nằm sau bàn
 * phím; chỉ visual viewport mới biết phần còn thấy được. Trả `null` khi tắt
 * hoặc trình duyệt không có `visualViewport` (khi đó giữ nguyên CSS).
 */
export function useVisualViewport(active: boolean): VisualViewportBox | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const vv = active ? window.visualViewport : null;
      if (!vv) return () => {};
      vv.addEventListener("resize", onChange);
      vv.addEventListener("scroll", onChange);
      return () => {
        vv.removeEventListener("resize", onChange);
        vv.removeEventListener("scroll", onChange);
      };
    },
    [active],
  );
  const snap = useSyncExternalStore(
    subscribe,
    active ? snapshot : serverSnapshot,
    serverSnapshot,
  );
  if (!snap) return null;
  const [height, bottomInset] = snap.split(":").map(Number);
  return { height, bottomInset };
}

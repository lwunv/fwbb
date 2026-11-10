"use client";

import { useCallback, useSyncExternalStore } from "react";

function hasMatchMedia(): boolean {
  return (
    typeof window !== "undefined" && typeof window.matchMedia === "function"
  );
}

/**
 * Kết quả của một media query, theo dõi khi đổi kích thước.
 *
 * Trả `null` ở server và trong lần hydrate đầu (server snapshot), nên HTML
 * server không phụ thuộc bề rộng máy; màn gọi tự vẽ skeleton cho giá trị đó.
 * Trình duyệt không có `matchMedia` (webview rất cũ) coi như không khớp.
 */
export function useMediaQuery(query: string): boolean | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!hasMatchMedia()) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => (hasMatchMedia() ? window.matchMedia(query).matches : false),
    () => null,
  );
}

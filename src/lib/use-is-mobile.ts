"use client";

import { useEffect, useState } from "react";

/**
 * Returns true when viewport width is below `breakpoint` (default 640px =
 * Tailwind `sm:`). Re-evaluates on resize via `matchMedia`. Shared by
 * responsive Dialog ↔ Sheet wrappers (confirm-dialog, price-override-sheet,
 * v.v.) so the mobile breakpoint stays consistent.
 *
 * Why a hook (not just a CSS class): we need to render *different React
 * trees* on mobile vs desktop (bottom Sheet vs centered Dialog) — CSS-only
 * approach would render both and lose accessibility focus management.
 */
export function useIsMobile(breakpoint = 640): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [breakpoint]);
  return isMobile;
}

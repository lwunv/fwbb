"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { FloatingDecorations } from "./floating-decorations";
import { ClickHearts } from "./click-hearts";

/**
 * Bông tuyết + tim bay + click-heart burst CHỈ bật ở theme "pink" (yêu cầu:
 * dark/light KHÔNG có hiệu ứng). next-themes resolve theme ở client → cần
 * mounted guard tránh hydration mismatch (server không biết theme).
 */
export function PinkThemeEffects() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mounted guard cho next-themes (theme chỉ biết ở client), chạy 1 lần.
    setMounted(true);
  }, []);
  if (!mounted || resolvedTheme !== "pink") return null;
  return (
    <>
      <FloatingDecorations />
      <ClickHearts />
    </>
  );
}

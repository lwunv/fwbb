"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";

/**
 * Force "pink" làm theme mặc định cho khu vực admin — chỉ apply ở lần đầu
 * (chưa có theme nào trong localStorage). Khi user đã chọn theme khác qua
 * theme-toggle, tôn trọng lựa chọn đó và không override.
 *
 * Mount trong admin layout (sau khi đã pass auth gate) để khách chưa login
 * vẫn dùng theme mặc định gốc của site.
 */
export function AdminDefaultTheme() {
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("theme");
    if (!stored && theme !== "pink") setTheme("pink");
  }, [theme, setTheme]);

  return null;
}

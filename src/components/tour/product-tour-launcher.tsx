"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Compass } from "lucide-react";
import { useProductTour } from "./use-product-tour";

/**
 * Nút fixed góc dưới phải mở product tour, + auto chạy lần đầu (localStorage).
 * Chỉ render trong (public) layout nhánh member đã approved.
 */
export function ProductTourLauncher() {
  const { run, hasSeen } = useProductTour();
  const t = useTranslations("tour");
  const autoRan = useRef(false);

  useEffect(() => {
    if (autoRan.current) return;
    autoRan.current = true;
    if (!hasSeen()) {
      // Đợi DOM (vote panel, banner) mount xong rồi mới chạy.
      const id = setTimeout(() => run(), 800);
      return () => clearTimeout(id);
    }
  }, [hasSeen, run]);

  return (
    <button
      type="button"
      onClick={run}
      aria-label={t("open")}
      className="bg-primary text-primary-foreground fixed right-4 bottom-24 z-30 flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-transform active:scale-95 sm:bottom-6"
    >
      <Compass className="h-5 w-5" />
    </button>
  );
}

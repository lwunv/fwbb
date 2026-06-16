"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Compass } from "lucide-react";
import { useProductTour } from "./use-product-tour";

/**
 * Nút fixed góc dưới phải mở product tour, + auto chạy lần đầu (localStorage).
 * Chỉ render trong (public) layout nhánh member đã approved.
 *
 * z-50 để LUÔN nổi trên BottomNav (z-40) + sticky vote bar (z-30) — trước đây
 * z-30 nên bị nav che mất nửa dưới. `bottom-24` nâng khỏi nav (h-16) trên mọi
 * breakpoint (bỏ `sm:bottom-6` cũ vì nó nằm chìm dưới nav trên desktop).
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
      data-tour="tour-launcher"
      aria-label={t("open")}
      title={t("open")}
      className="from-primary to-primary/80 ring-primary/20 fixed right-4 bottom-24 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br text-white shadow-xl ring-4 transition-transform hover:scale-105 active:scale-95"
    >
      <Compass className="h-5 w-5" />
    </button>
  );
}

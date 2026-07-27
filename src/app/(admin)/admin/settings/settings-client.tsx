"use client";

import type { AppSettings } from "@/lib/settings-registry";
import { SectionSessionDefaults } from "./section-session-defaults";

interface CourtOpt {
  id: number;
  name: string;
  pricePerSession: number;
}
interface BrandOpt {
  id: number;
  name: string;
  pricePerTube: number;
}

/**
 * Khung trang Cài đặt. Ghép các section; tách file riêng cho từng section vì
 * trang còn phình thêm ở các giai đoạn kế tiếp.
 */
export function SettingsClient({
  settings,
  courts,
  brands,
}: {
  settings: AppSettings;
  courts: CourtOpt[];
  brands: BrandOpt[];
}) {
  return (
    <div className="space-y-4">
      <SectionSessionDefaults
        settings={settings}
        courts={courts}
        brands={brands}
      />
      {/* Task 9 cắm section ngưỡng vào đây. */}
      {/* Task 10 cắm section vận hành vào đây. */}
    </div>
  );
}

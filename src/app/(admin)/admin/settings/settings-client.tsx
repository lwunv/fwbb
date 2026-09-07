"use client";

import type { AppSettings } from "@/lib/settings-registry";
import { SectionMoney } from "./section-money";
import { SectionSessionDefaults } from "./section-session-defaults";
import { SectionThresholds } from "./section-thresholds";
import { SectionOperations } from "./section-operations";

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
      <SectionMoney settings={settings} />
      <SectionSessionDefaults
        settings={settings}
        courts={courts}
        brands={brands}
      />
      <SectionThresholds settings={settings} />
      <SectionOperations settings={settings} />
    </div>
  );
}

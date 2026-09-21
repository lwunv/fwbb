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
  unsetGenderCount = 0,
}: {
  settings: AppSettings;
  courts: CourtOpt[];
  brands: BrandOpt[];
  /** Số thành viên còn hoạt động chưa khai giới tính. Chỉ là con số, không
   *  kèm danh sách tên. */
  unsetGenderCount?: number;
}) {
  return (
    <div className="space-y-4">
      <SectionMoney settings={settings} unsetGenderCount={unsetGenderCount} />
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

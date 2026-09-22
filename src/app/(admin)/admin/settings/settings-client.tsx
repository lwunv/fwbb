"use client";

import type { AppSettings } from "@/lib/settings-registry";
import { SettingsDraftProvider } from "./settings-draft";
import { SettingsSaveBar } from "./settings-save-bar";
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
 *
 * Cả trang nằm trong MỘT bản nháp: các section chỉ sửa nháp, `SettingsSaveBar`
 * là chỗ duy nhất gọi server. Trước đây mỗi ô tự ghi ngay lúc đổi, admin không
 * có bước xem lại trên chính trang quyết định cách chia tiền.
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
    <SettingsDraftProvider settings={settings}>
      <div className="space-y-4">
        <SectionMoney unsetGenderCount={unsetGenderCount} />
        <SectionSessionDefaults courts={courts} brands={brands} />
        <SectionThresholds />
        <SectionOperations />
      </div>
      <SettingsSaveBar />
    </SettingsDraftProvider>
  );
}

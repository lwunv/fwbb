"use client";

import type { AppSettings } from "@/lib/settings-registry";

/**
 * Khung trang Cài đặt. Các section được cắm vào đây ở những task sau; tách file
 * riêng cho từng section vì trang này còn phình thêm ở các giai đoạn kế tiếp.
 */
export function SettingsClient({ settings }: { settings: AppSettings }) {
  return (
    <div className="space-y-4">
      {/* Task 7 cắm section mặc định buổi mới vào đây. */}
      {/* Task 9 cắm section ngưỡng vào đây. */}
      {/* Task 10 cắm section vận hành vào đây. */}
      <p className="text-muted-foreground text-sm">{settings.appName}</p>
    </div>
  );
}

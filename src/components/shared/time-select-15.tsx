"use client";

import { useState } from "react";
import { CustomSelect } from "@/components/ui/custom-select";

/**
 * Time picker giới hạn phút theo mốc 15p (00 / 15 / 30 / 45). Native
 * `<input type="time">` Chrome vẫn cho chọn mọi phút dù có `step="900"`,
 * nên dùng 2 select tùy chọn + hidden input để form chấp nhận giá trị HH:MM.
 *
 * Khi `defaultValue` không nằm trên mốc (e.g. "20:35"), round xuống mốc gần
 * nhất (35 → 30) để dropdown match được option hiện có.
 *
 * Chuyển từ `session-list.tsx` ra đây 01/11/2026 để màn sửa giờ của buổi đã
 * tạo dùng lại, thay vì chép thêm một bản thứ hai rồi hai bản lệch nhau.
 */
export function TimeSelect15({
  name,
  defaultValue,
  onValueChange,
}: {
  /** Có `name` thì kèm một hidden input, để dùng trong form gửi bằng FormData. */
  name?: string;
  defaultValue: string;
  /** Gọi mỗi lần đổi, cho nơi dùng không qua form. */
  onValueChange?: (value: string) => void;
}) {
  const [hRaw, mRaw] = defaultValue.split(":");
  const hInit = String(parseInt(hRaw ?? "0", 10) || 0).padStart(2, "0");
  const mInitNum = parseInt(mRaw ?? "0", 10) || 0;
  const mInit = String(Math.floor(mInitNum / 15) * 15).padStart(2, "0");
  const [hh, setHh] = useState(hInit);
  const [mm, setMm] = useState(mInit);
  const combined = `${hh}:${mm}`;

  const hourOptions = Array.from({ length: 24 }, (_, i) => ({
    value: String(i).padStart(2, "0"),
    label: `${String(i).padStart(2, "0")}h`,
  }));
  const minuteOptions = ["00", "15", "30", "45"].map((m) => ({
    value: m,
    label: m,
  }));

  return (
    <div className="flex gap-2">
      {name && <input type="hidden" name={name} value={combined} />}
      <CustomSelect
        value={hh}
        onChange={(v) => {
          setHh(v);
          onValueChange?.(`${v}:${mm}`);
        }}
        options={hourOptions}
        className="flex-1"
      />
      <CustomSelect
        value={mm}
        onChange={(v) => {
          setMm(v);
          onValueChange?.(`${hh}:${v}`);
        }}
        options={minuteOptions}
        className="flex-1"
      />
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn, formatDigitsVi, onlyDigits } from "@/lib/utils";

/**
 * Ô nhập số nguyên kiểu Việt (100000 hiện thành "100.000"), dùng chung cho mọi
 * chỗ admin gõ tiền hoặc ngưỡng.
 *
 * Ba thứ nó xử lý mà `<Input type="number">` trần không làm được:
 *
 * 1. **Hiển thị có dấu chấm.** `type="number"` không cho format, admin phải tự
 *    đếm số 0 để biết 100000 là một trăm nghìn hay một triệu.
 * 2. **Chỉ ghi khi rời ô.** Gọi `onCommit` ở blur/Enter chứ không ở từng phím.
 *    Gõ "100000" mà ghi theo mỗi ký tự là sáu lần ghi liên tiếp, vừa thừa vừa
 *    dễ ghi đè lẫn nhau vì không có gì đảm bảo thứ tự request về.
 * 3. **Xoá trắng không thành 0.** `Number("")` là 0, nên ô ghi-theo-phím sẽ âm
 *    thầm đặt ngưỡng về 0 ngay khi admin bôi đen xoá để gõ lại. Ở đây chuỗi
 *    rỗng được coi là "chưa nhập xong": rời ô thì trả về giá trị cũ, không ghi.
 *
 * Giá trị luôn là số nguyên không âm. State trong ruột giữ CHUỖI chữ số, không
 * giữ number, để chuỗi rỗng và "0" là hai trạng thái khác nhau.
 */
export function MoneyInput({
  value,
  onCommit,
  suffix,
  "aria-label": ariaLabel,
  className,
  disabled,
}: {
  /** Giá trị đã chốt (từ server hoặc state cha). */
  value: number;
  /** Chạy khi rời ô hoặc Enter, và CHỈ khi giá trị thật sự đổi. */
  onCommit: (next: number) => void;
  suffix?: string;
  "aria-label"?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));

  // Đồng bộ lại khi giá trị chốt đổi từ bên ngoài (server revalidate, hoặc
  // rollback sau khi ghi hỏng). Không có bước này thì ô kẹt ở số admin vừa gõ
  // dù server đã từ chối.
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  function commit() {
    const digits = onlyDigits(draft);
    if (digits === "") {
      // Chưa nhập gì thì coi như không đổi, trả ô về giá trị cũ.
      setDraft(String(value));
      return;
    }
    const next = Number(digits);
    if (!Number.isSafeInteger(next) || next < 0) {
      setDraft(String(value));
      return;
    }
    setDraft(String(next));
    if (next !== value) onCommit(next);
  }

  const field = (
    <Input
      inputMode="numeric"
      pattern="[0-9.]*"
      aria-label={ariaLabel}
      disabled={disabled}
      value={formatDigitsVi(draft)}
      onChange={(e) => setDraft(onlyDigits(e.target.value))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      className={cn("min-h-11 tabular-nums", className)}
    />
  );

  if (!suffix) return field;

  return (
    <div className="flex items-center gap-2">
      {field}
      <span className="text-muted-foreground shrink-0 text-sm">{suffix}</span>
    </div>
  );
}

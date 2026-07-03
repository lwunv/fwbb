"use client";

import * as React from "react";
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "@/lib/utils";

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    // Track thị giác chỉ 24×40px nhưng vùng chạm thật phải ≥44px (mobile-first
    // bắt buộc) — bọc span đệm vô hình thay vì to hẳn cái track lên, giữ đúng
    // tỉ lệ hình ảnh switch chuẩn trong khi tap-target vẫn đủ 44px mọi hướng.
    <span className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center">
      <SwitchPrimitive.Root
        data-slot="switch"
        className={cn(
          "focus-visible:ring-ring/50 data-checked:bg-primary bg-muted inline-flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      >
        <SwitchPrimitive.Thumb
          data-slot="switch-thumb"
          className="bg-background block size-5 rounded-full shadow-sm transition-transform data-checked:translate-x-4"
        />
      </SwitchPrimitive.Root>
    </span>
  );
}

export { Switch };

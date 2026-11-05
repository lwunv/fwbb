"use client";

import { ResponsiveSheet } from "@/components/exchange/responsive-sheet";
import { Button } from "@/components/ui/button";

/**
 * Hỏi lại trước thao tác không hoàn tác được của luồng giao lưu: bottom sheet
 * trên mobile (nút 44px ở đáy, chữ 16px), hộp thoại từ `sm:`. Bấm xác nhận thì
 * đóng ngay rồi mới gọi `onConfirm`; caller lo phần lạc quan và hoàn lại.
 */
export function ConfirmSheet({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  destructive = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  destructive?: boolean;
}) {
  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="min-h-11 flex-1"
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            className="min-h-11 flex-1 font-semibold"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <p className="text-muted-foreground text-base">{description}</p>
    </ResponsiveSheet>
  );
}

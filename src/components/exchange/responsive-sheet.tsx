"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/lib/use-is-mobile";
import { useVisualViewport } from "@/lib/use-visual-viewport";
import { cn } from "@/lib/utils";

/**
 * Bottom sheet trên mobile, hộp thoại giữa màn hình từ `sm:` trở lên. Nội dung
 * cuộn được để form dài (Turnstile, bàn phím) không bị cắt trên màn nhỏ.
 *
 * `footer` là chỗ cho nút chính: trên mobile nó dính đáy sheet (vùng ngón cái)
 * kể cả khi form dài phải cuộn, và tự chừa vùng an toàn của iPhone.
 *
 * Bàn phím iOS không làm co `92dvh`, nên lúc gõ nhận xét nút chính bị bàn phím
 * che. Khi mở trên mobile, sheet bám theo `visualViewport`: đáy sheet nằm trên
 * mép bàn phím và chiều cao tối đa tính theo phần còn thấy được.
 */
export function ResponsiveSheet({
  open,
  onOpenChange,
  title,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  const hasFooter = footer !== undefined && footer !== null && footer !== false;
  const viewport = useVisualViewport(isMobile && open);
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className={cn(
            "max-h-[92dvh] overflow-y-auto rounded-t-2xl",
            !hasFooter && "pb-[env(safe-area-inset-bottom)]",
          )}
          style={
            viewport
              ? {
                  bottom: `${viewport.bottomInset}px`,
                  maxHeight: `${Math.floor(viewport.height * 0.92)}px`,
                }
              : undefined
          }
        >
          <SheetHeader>
            <SheetTitle className="text-lg font-semibold">{title}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 px-4 pb-4">{children}</div>
          {hasFooter && (
            <div
              data-slot="responsive-sheet-footer"
              className="bg-background/95 sticky bottom-0 z-10 -mt-4 border-t px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] backdrop-blur"
            >
              {footer}
            </div>
          )}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">{children}</div>
        {hasFooter && <div data-slot="responsive-sheet-footer">{footer}</div>}
      </DialogContent>
    </Dialog>
  );
}

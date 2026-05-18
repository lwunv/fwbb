"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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
  SheetFooter,
} from "@/components/ui/sheet";
import { AlertTriangle } from "lucide-react";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "destructive" | "default";
  onConfirm: () => void | Promise<void>;
  /** Optional content rendered giữa description và button row (vd: form input) */
  children?: React.ReactNode;
}

function useIsMobile(breakpoint = 640) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [breakpoint]);
  return isMobile;
}

/**
 * Responsive confirm prompt: bottom Sheet on mobile (rubric §6),
 * centered Dialog from sm: upward.
 *
 * Optimistic semantics (CLAUDE.md "100% Optimistic UI"): khi user click
 * Confirm, dialog đóng NGAY LẬP TỨC + onConfirm fire-and-forget. Parent
 * sở hữu rollback (qua fireAction từ src/lib/optimistic-action.ts). Nếu
 * parent return Promise reject, catch ở đây nuốt để page không crash —
 * toast.error nên đã được fireAction surfaces.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const isMobile = useIsMobile();
  return isMobile ? <MobileSheet {...props} /> : <DesktopDialog {...props} />;
}

function ConfirmHeader({
  variant,
  title,
}: {
  variant: ConfirmDialogProps["variant"];
  title: string;
}) {
  return (
    <span className="flex items-center gap-3">
      <span
        className={`inline-flex rounded-full p-2 ${
          variant === "destructive"
            ? "bg-red-100 dark:bg-red-900/30"
            : "bg-primary/10"
        }`}
      >
        <AlertTriangle
          className={`h-5 w-5 ${
            variant === "destructive"
              ? "text-red-600 dark:text-red-400"
              : "text-primary"
          }`}
        />
      </span>
      <span className="text-base font-semibold">{title}</span>
    </span>
  );
}

function ConfirmActions({
  variant,
  onCancel,
  onConfirm,
  cancelLabel,
  confirmLabel,
}: {
  variant: ConfirmDialogProps["variant"];
  onCancel: () => void;
  onConfirm: () => void;
  cancelLabel: string;
  confirmLabel: string;
}) {
  return (
    <div className="flex justify-end gap-2">
      <Button variant="outline" onClick={onCancel}>
        {cancelLabel}
      </Button>
      <Button variant={variant} onClick={onConfirm}>
        {confirmLabel}
      </Button>
    </div>
  );
}

function fireConfirm(
  onConfirm: () => void | Promise<void>,
  onOpenChange: (open: boolean) => void,
) {
  // Optimistic: close dialog ngay, sau đó fire onConfirm. Parent's fireAction
  // pattern handles rollback + toast.error. catch ở đây để swallow stray
  // rejections — không bao giờ crash page chỉ vì server fail.
  onOpenChange(false);
  Promise.resolve(onConfirm()).catch(() => {});
}

function DesktopDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant = "destructive",
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const tCommon = useTranslations("common");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">
            <ConfirmHeader
              variant={variant}
              title={title ?? tCommon("confirmDelete")}
            />
          </DialogTitle>
        </DialogHeader>
        {description && (
          <p className="text-muted-foreground ml-12 text-sm">{description}</p>
        )}
        {children && <div className="mt-2">{children}</div>}
        <div className="mt-2">
          <ConfirmActions
            variant={variant}
            onCancel={() => onOpenChange(false)}
            onConfirm={() => fireConfirm(onConfirm, onOpenChange)}
            cancelLabel={cancelLabel ?? tCommon("cancel")}
            confirmLabel={confirmLabel ?? tCommon("confirm")}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MobileSheet({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant = "destructive",
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const tCommon = useTranslations("common");
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="bg-popover rounded-t-2xl border-t pb-[env(safe-area-inset-bottom)]"
      >
        <SheetHeader>
          <SheetTitle className="text-base">
            <ConfirmHeader
              variant={variant}
              title={title ?? tCommon("confirmDelete")}
            />
          </SheetTitle>
        </SheetHeader>
        {description ? (
          <p className="text-muted-foreground px-4 text-sm">{description}</p>
        ) : null}
        {children && <div className="px-4">{children}</div>}
        <SheetFooter>
          <ConfirmActions
            variant={variant}
            onCancel={() => onOpenChange(false)}
            onConfirm={() => fireConfirm(onConfirm, onOpenChange)}
            cancelLabel={cancelLabel ?? tCommon("cancel")}
            confirmLabel={confirmLabel ?? tCommon("confirm")}
          />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

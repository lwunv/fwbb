"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
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
import { useIsMobile } from "@/lib/use-is-mobile";

export interface ConfirmOptions {
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "destructive" | "default";
}

type ConfirmFn = (opts?: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Promise-based confirm dùng chung — thay `window.confirm()` (xấu, chặn UI,
 * lệch theme). `const ok = await confirm({ title, description, variant })`.
 *
 * Tự chủ thứ tự resolve: Confirm → resolve(true); Cancel/đóng → resolve(false).
 * Responsive: Sheet đáy trên mobile, Dialog giữa trên desktop. Mount 1 lần ở
 * Providers → mọi client component gọi `useConfirm()` được.
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const tCommon = useTranslations("common");
  const isMobile = useIsMobile();
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  // Giữ resolver hiện tại; consume-once để tránh double-resolve.
  const resolverRef = useRef<((v: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setOpts(null);
    resolve?.(value);
  }, []);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setOpts(options ?? {});
    });
  }, []);

  const open = opts !== null;
  const variant = opts?.variant ?? "destructive";
  const title = opts?.title ?? tCommon("confirm");
  const description = opts?.description;
  const confirmLabel = opts?.confirmLabel ?? tCommon("confirm");
  const cancelLabel = opts?.cancelLabel ?? tCommon("cancel");

  const header = (
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

  const actions = (
    <div className="flex justify-end gap-2">
      <Button
        variant="outline"
        className="min-h-11"
        onClick={() => settle(false)}
      >
        {cancelLabel}
      </Button>
      <Button
        variant={variant}
        className="min-h-11"
        onClick={() => settle(true)}
      >
        {confirmLabel}
      </Button>
    </div>
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {isMobile ? (
        <Sheet open={open} onOpenChange={(o) => !o && settle(false)}>
          <SheetContent
            side="bottom"
            className="bg-popover rounded-t-2xl border-t pb-[env(safe-area-inset-bottom)]"
          >
            <SheetHeader>
              <SheetTitle className="text-base">{header}</SheetTitle>
            </SheetHeader>
            {description && (
              <p className="text-muted-foreground px-4 text-sm">
                {description}
              </p>
            )}
            <SheetFooter>{actions}</SheetFooter>
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={open} onOpenChange={(o) => !o && settle(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-base">{header}</DialogTitle>
            </DialogHeader>
            {description && (
              <p className="text-muted-foreground ml-12 text-sm">
                {description}
              </p>
            )}
            <div className="mt-2">{actions}</div>
          </DialogContent>
        </Dialog>
      )}
    </ConfirmContext.Provider>
  );
}

/** Hook trả về hàm `confirm(opts) => Promise<boolean>`. Phải nằm dưới ConfirmProvider. */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm must be used within <ConfirmProvider>");
  }
  return ctx;
}

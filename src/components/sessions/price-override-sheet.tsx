"use client";

import { useEffect, useState } from "react";
import { useIsMobile } from "@/lib/use-is-mobile";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { formatK } from "@/lib/utils";
import { Minus, Pencil, Plus, RotateCcw } from "lucide-react";

interface PriceOverrideSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Label hiển thị bên trên input, vd: "Tiền sân (VND)" hoặc "Giá/ống (VND)" */
  inputLabel: string;
  /** Giá hiện tại đang dùng cho buổi này (có thể là giá đã override hoặc auto). */
  currentValue: number;
  /** Giá auto/mặc định để gợi ý — hiển thị bên dưới input. */
  defaultValue: number;
  /** True nếu giá đang là override → cho phép Reset. */
  isOverridden: boolean;
  /** Gọi với số VND nguyên khi admin lưu. */
  onSave: (value: number) => void | Promise<void>;
  /** Gọi khi admin bấm "Reset về mặc định" (chỉ enabled nếu `isOverridden`). */
  onReset: () => void | Promise<void>;
}

/**
 * Bottom sheet (mobile) / centered dialog (desktop) để admin nhập giá override.
 * Input lấy số nguyên VND (no decimals). Có 2 nút action:
 *   - "Lưu" → onSave(value)
 *   - "Về mặc định" → onReset() (disable nếu chưa override)
 */
export function PriceOverrideSheet(props: PriceOverrideSheetProps) {
  const isMobile = useIsMobile();
  return isMobile ? <MobileSheet {...props} /> : <DesktopDialog {...props} />;
}

function OverrideHeader({ title }: { title: string }) {
  return (
    <span className="flex items-center gap-3">
      <span className="bg-primary/10 inline-flex rounded-full p-2">
        <Pencil className="text-primary h-5 w-5" />
      </span>
      <span className="text-base font-semibold">{title}</span>
    </span>
  );
}

/** Format chuỗi chữ số "330000" → "330.000" (vi-VN). Rỗng → rỗng. */
function formatDigitsVi(digits: string): string {
  if (!digits) return "";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function OverrideBody({
  inputLabel,
  defaultValue,
  isOverridden,
  value,
  setValue,
}: {
  inputLabel: string;
  defaultValue: number;
  isOverridden: boolean;
  value: string;
  setValue: (v: string) => void;
}) {
  const t = useTranslations("priceOverride");

  /** Đổi value theo bước (±5k). Floor về bội số 5k để bấm 1 lần luôn về số
   * tròn (vd nhập 27.000 bấm + → 30.000 chứ không phải 32.000). */
  function bump(delta: number) {
    const current = value.length > 0 ? Number(value) : 0;
    const STEP = 5000;
    const aligned = Math.floor(current / STEP) * STEP;
    const next = Math.max(
      0,
      delta > 0
        ? (aligned === current ? current : aligned) + STEP
        : aligned === current
          ? current - STEP
          : aligned,
    );
    setValue(String(next));
  }

  return (
    <div className="space-y-2 py-2">
      <label className="text-foreground block text-sm font-medium">
        {inputLabel}
      </label>
      <div className="bg-background flex h-12 items-stretch overflow-hidden rounded-xl border-2">
        <button
          type="button"
          onClick={() => bump(-1)}
          disabled={(value.length > 0 ? Number(value) : 0) <= 0}
          className="hover:bg-accent flex w-12 shrink-0 items-center justify-center border-r transition-colors disabled:opacity-40"
          aria-label="-5.000"
        >
          <Minus className="h-5 w-5" />
        </button>
        <Input
          inputMode="numeric"
          pattern="[0-9.]*"
          autoFocus
          value={formatDigitsVi(value)}
          onChange={(e) => {
            // Strip mọi ký tự không phải chữ số — admin có thể nhập / paste
            // "200.000đ", "200,000", "200 000"... đều OK; state luôn giữ raw
            // digits, display luôn format vi-VN với dấu chấm.
            const digits = e.target.value.replace(/[^\d]/g, "");
            setValue(digits);
          }}
          placeholder="0"
          className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent text-center text-lg font-bold tabular-nums focus-visible:ring-0"
        />
        <button
          type="button"
          onClick={() => bump(1)}
          className="hover:bg-accent flex w-12 shrink-0 items-center justify-center border-l transition-colors"
          aria-label="+5.000"
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>
      <p className="text-muted-foreground text-xs">
        {t("defaultHint", { amount: formatK(defaultValue) })}
        {isOverridden ? ` ${t("customSuffix")}` : ""}
      </p>
    </div>
  );
}

function OverrideActions({
  canSave,
  canReset,
  onCancel,
  onSave,
  onReset,
  saveLabel,
  resetLabel,
  cancelLabel,
}: {
  canSave: boolean;
  canReset: boolean;
  onCancel: () => void;
  onSave: () => void;
  onReset: () => void;
  saveLabel: string;
  resetLabel: string;
  cancelLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button
        variant="outline"
        onClick={onReset}
        disabled={!canReset}
        className="gap-1"
      >
        <RotateCcw className="h-4 w-4" />
        {resetLabel}
      </Button>
      <Button variant="outline" onClick={onCancel}>
        {cancelLabel}
      </Button>
      <Button onClick={onSave} disabled={!canSave}>
        {saveLabel}
      </Button>
    </div>
  );
}

function DesktopDialog({
  open,
  onOpenChange,
  title,
  inputLabel,
  currentValue,
  defaultValue,
  isOverridden,
  onSave,
  onReset,
}: PriceOverrideSheetProps) {
  const tCommon = useTranslations("common");
  const tOverride = useTranslations("priceOverride");
  const [value, setValue] = useState(String(currentValue));

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resync input value when dialog opens or server-side override updates.
      setValue(String(currentValue));
    }
  }, [open, currentValue]);

  const parsed = value.length > 0 ? Number(value) : NaN;
  const canSave =
    Number.isFinite(parsed) && parsed >= 0 && parsed !== currentValue;

  function handleSave() {
    if (!canSave) return;
    // Optimistic: close immediately, parent owns the fire-and-forget action +
    // rollback. Loading flicker (microtask-wait on a parent that uses
    // fireAction) was UX-hostile; if the parent does block on server, that's
    // the parent's bug to fix per CLAUDE.md "100% optimistic UI".
    onOpenChange(false);
    Promise.resolve(onSave(parsed)).catch(() => {
      // Parent's fireAction surfaces toast.error already; swallow stray
      // rejections so the page doesn't crash.
    });
  }
  function handleReset() {
    onOpenChange(false);
    Promise.resolve(onReset()).catch(() => {});
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">
            <OverrideHeader title={title} />
          </DialogTitle>
        </DialogHeader>
        <OverrideBody
          inputLabel={inputLabel}
          defaultValue={defaultValue}
          isOverridden={isOverridden}
          value={value}
          setValue={setValue}
        />
        <OverrideActions
          canSave={canSave}
          canReset={isOverridden}
          onCancel={() => onOpenChange(false)}
          onSave={handleSave}
          onReset={handleReset}
          saveLabel={tCommon("save")}
          resetLabel={tOverride("resetButton")}
          cancelLabel={tCommon("cancel")}
        />
      </DialogContent>
    </Dialog>
  );
}

function MobileSheet({
  open,
  onOpenChange,
  title,
  inputLabel,
  currentValue,
  defaultValue,
  isOverridden,
  onSave,
  onReset,
}: PriceOverrideSheetProps) {
  const tCommon = useTranslations("common");
  const tOverride = useTranslations("priceOverride");
  const [value, setValue] = useState(String(currentValue));

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resync input value when dialog opens or server-side override updates.
      setValue(String(currentValue));
    }
  }, [open, currentValue]);

  const parsed = value.length > 0 ? Number(value) : NaN;
  const canSave =
    Number.isFinite(parsed) && parsed >= 0 && parsed !== currentValue;

  function handleSave() {
    if (!canSave) return;
    // Optimistic: close immediately, parent owns the fire-and-forget action +
    // rollback. Loading flicker (microtask-wait on a parent that uses
    // fireAction) was UX-hostile; if the parent does block on server, that's
    // the parent's bug to fix per CLAUDE.md "100% optimistic UI".
    onOpenChange(false);
    Promise.resolve(onSave(parsed)).catch(() => {
      // Parent's fireAction surfaces toast.error already; swallow stray
      // rejections so the page doesn't crash.
    });
  }
  function handleReset() {
    onOpenChange(false);
    Promise.resolve(onReset()).catch(() => {});
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="bg-popover rounded-t-2xl border-t pb-[env(safe-area-inset-bottom)]"
      >
        <SheetHeader>
          <SheetTitle className="text-base">
            <OverrideHeader title={title} />
          </SheetTitle>
        </SheetHeader>
        <div className="px-4">
          <OverrideBody
            inputLabel={inputLabel}
            defaultValue={defaultValue}
            isOverridden={isOverridden}
            value={value}
            setValue={setValue}
          />
        </div>
        <SheetFooter>
          <OverrideActions
            canSave={canSave}
            canReset={isOverridden}
            onCancel={() => onOpenChange(false)}
            onSave={handleSave}
            onReset={handleReset}
            saveLabel={tCommon("save")}
            resetLabel={tOverride("resetButton")}
            cancelLabel={tCommon("cancel")}
          />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

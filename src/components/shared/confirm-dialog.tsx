"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant = "destructive",
  onConfirm,
  loading = false,
}: ConfirmDialogProps) {
  const tCommon = useTranslations("common");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className={`rounded-full p-2 ${variant === "destructive" ? "bg-red-100 dark:bg-red-900/30" : "bg-primary/10"}`}>
              <AlertTriangle className={`h-5 w-5 ${variant === "destructive" ? "text-red-600 dark:text-red-400" : "text-primary"}`} />
            </div>
            <DialogTitle className="text-base">
              {title ?? tCommon("confirmDelete")}
            </DialogTitle>
          </div>
        </DialogHeader>
        {description && (
          <p className="text-sm text-muted-foreground ml-12">
            {description}
          </p>
        )}
        <div className="flex gap-2 justify-end mt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            {cancelLabel ?? tCommon("cancel")}
          </Button>
          <Button
            variant={variant}
            size="sm"
            onClick={async () => {
              await onConfirm();
              onOpenChange(false);
            }}
            disabled={loading}
          >
            {loading ? tCommon("processing") : (confirmLabel ?? tCommon("confirm"))}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

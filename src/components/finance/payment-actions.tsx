"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { confirmPaymentByAdmin, undoPaymentByAdmin } from "@/actions/finance";
import { CheckCircle, Loader2, Undo2 } from "lucide-react";

interface PaymentActionsProps {
  debtId: number;
  memberConfirmed: boolean;
  adminConfirmed: boolean;
}

export function PaymentActions({
  debtId,
  memberConfirmed,
  adminConfirmed,
}: PaymentActionsProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const t = useTranslations("finance");

  async function handleConfirm() {
    setIsLoading(true);
    setError("");
    const result = await confirmPaymentByAdmin(debtId);
    if (result.error) setError(result.error);
    setIsLoading(false);
  }

  async function handleUndo() {
    setIsLoading(true);
    setError("");
    const result = await undoPaymentByAdmin(debtId);
    if (result.error) setError(result.error);
    setIsLoading(false);
  }

  if (adminConfirmed) {
    return (
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 font-medium">
          <CheckCircle className="h-3 w-3" />
          {t("received")}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleUndo}
          disabled={isLoading}
          className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
        >
          {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3 mr-0.5" />}
          {t("undo")}
        </Button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {memberConfirmed && (
        <span className="text-xs text-muted-foreground">{t("memberReported")}</span>
      )}
      <Button
        size="sm"
        onClick={handleConfirm}
        disabled={isLoading}
      >
        {isLoading ? (
          <Loader2 className="h-3 w-3 animate-spin mr-1" />
        ) : (
          <CheckCircle className="h-3 w-3 mr-1" />
        )}
        {t("received")}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

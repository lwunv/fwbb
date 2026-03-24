"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { confirmPaymentByAdmin } from "@/actions/finance";
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
    if (result.error) {
      setError(result.error);
    }
    setIsLoading(false);
  }

  if (adminConfirmed) {
    return (
      <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 font-medium">
        <CheckCircle className="h-3 w-3" />
        {t("received")}
      </span>
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
        {t("confirmReceived")}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

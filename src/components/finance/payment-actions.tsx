"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { confirmPaymentByAdmin, undoPaymentByAdmin } from "@/actions/finance";
import { CheckCircle, Loader2 } from "lucide-react";

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
        <Button
          variant="outline"
          size="sm"
          onClick={handleUndo}
          disabled={isLoading}
          className="h-6 px-2 text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
        >
          {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {t("notReceived")}
        </Button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
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
      {memberConfirmed && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleUndo}
          disabled={isLoading}
          className="h-6 px-2 text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
        >
          {t("notReceived")}
        </Button>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

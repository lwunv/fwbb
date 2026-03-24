"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { confirmPaymentByAdmin } from "@/actions/finance";
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

  if (adminConfirmed) {
    return (
      <span className="flex items-center gap-1 text-xs text-primary font-medium">
        <CheckCircle className="h-3 w-3" />
        Da xac nhan
      </span>
    );
  }

  async function handleConfirm() {
    setIsLoading(true);
    setError("");
    const result = await confirmPaymentByAdmin(debtId);
    if (result.error) {
      setError(result.error);
    }
    setIsLoading(false);
  }

  return (
    <div className="flex items-center gap-2">
      {memberConfirmed && (
        <span className="text-xs text-muted-foreground">TV da bao</span>
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
        Xac nhan
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

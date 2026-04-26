"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { confirmPaymentByAdmin, undoPaymentByAdmin } from "@/actions/finance";
import { fireAction } from "@/lib/optimistic-action";
import { CheckCircle } from "lucide-react";

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
  const [optimisticConfirmed, setOptimisticConfirmed] =
    useState(adminConfirmed);
  const t = useTranslations("finance");

  // Sync local optimistic state when server props change (revalidation / rollback)
  useEffect(() => {
    setOptimisticConfirmed(adminConfirmed);
  }, [adminConfirmed]);

  function handleConfirm() {
    setOptimisticConfirmed(true);
    fireAction(
      () => confirmPaymentByAdmin(debtId),
      () => setOptimisticConfirmed(false),
    );
  }

  function handleUndo() {
    setOptimisticConfirmed(false);
    fireAction(
      () => undoPaymentByAdmin(debtId),
      () => setOptimisticConfirmed(true),
    );
  }

  if (optimisticConfirmed) {
    return (
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleUndo}
          className="border-destructive/40 text-destructive hover:bg-destructive/10"
        >
          {t("notReceived")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Button size="sm" onClick={handleConfirm}>
        <CheckCircle className="mr-1 h-4 w-4" />
        {t("received")}
      </Button>
      {memberConfirmed && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleUndo}
          className="border-destructive/40 text-destructive hover:bg-destructive/10"
        >
          {t("notReceived")}
        </Button>
      )}
    </div>
  );
}

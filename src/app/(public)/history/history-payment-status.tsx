"use client";

import { Fragment, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { confirmPaymentByMember } from "@/actions/finance";
import { fireAction } from "@/lib/optimistic-action";

import type { HistoryDebtLite } from "./history-activity-icons";

interface HistoryPaymentStatusProps {
  debtId: number | null;
  debt: HistoryDebtLite | null;
}

export function HistoryPaymentStatus({
  debtId,
  debt,
}: HistoryPaymentStatusProps) {
  const t = useTranslations("history");

  const hasDebt = !!debt && debt.totalAmount > 0;
  const serverPaid = !!(debt?.adminConfirmed || debt?.memberConfirmed);

  const [optimisticPaid, setOptimisticPaid] = useState(serverPaid);

  // Sync local optimistic state when server props change (revalidation / rollback)
  useEffect(() => {
    setOptimisticPaid(serverPaid);
  }, [serverPaid]);

  function handleMarkPaid(e: React.MouseEvent) {
    e.stopPropagation();
    if (!debtId) return;
    setOptimisticPaid(true);
    fireAction(
      () => confirmPaymentByMember(debtId),
      () => setOptimisticPaid(false),
    );
  }

  if (!debtId || !hasDebt) {
    return (
      <div className="flex min-w-0 shrink-0 items-center">
        <p className="text-muted-foreground text-xs leading-snug">
          {t("noDebt")}
        </p>
      </div>
    );
  }

  if (optimisticPaid) {
    return (
      <div className="flex min-w-0 shrink-0 items-center">
        <p className="text-xs leading-snug font-semibold text-green-600 dark:text-green-400">
          {t("paidStatus")}
        </p>
      </div>
    );
  }

  return (
    <Fragment>
      <p className="text-destructive shrink-0 text-sm leading-tight font-medium whitespace-nowrap">
        {t("unpaidStatus")}
      </p>
      <Button
        type="button"
        size="sm"
        onClick={handleMarkPaid}
        className="shrink-0 whitespace-nowrap"
      >
        {t("markPaidButton")}
      </Button>
    </Fragment>
  );
}

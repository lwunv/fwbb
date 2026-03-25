"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { confirmPaymentByMember } from "@/actions/finance";

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
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const hasDebt = !!debt && debt.totalAmount > 0;
  const paid = !!(debt?.adminConfirmed || debt?.memberConfirmed);

  async function handleMarkPaid(e: React.MouseEvent) {
    e.stopPropagation();
    if (!debtId || loading) return;
    setError("");
    setLoading(true);
    const result = await confirmPaymentByMember(debtId);
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  if (!debtId || !hasDebt) {
    return (
      <div className="flex min-w-0 items-center shrink-0">
        <p className="text-[10px] text-muted-foreground leading-snug">{t("noDebt")}</p>
      </div>
    );
  }

  if (paid) {
    return (
      <div className="flex min-w-0 items-center shrink-0">
        <p className="text-xs font-semibold leading-snug text-green-600 dark:text-green-400">
          {t("paidStatus")}
        </p>
      </div>
    );
  }

  return (
    <Fragment>
      <p className="shrink-0 text-[10px] font-medium leading-tight text-destructive whitespace-nowrap">
        {t("unpaidStatus")}
      </p>
      <Button
        type="button"
        size="sm"
        disabled={loading}
        onClick={handleMarkPaid}
        className="h-8 shrink-0 px-2.5 text-xs font-medium whitespace-nowrap"
      >
        {loading ? "…" : t("markPaidButton")}
      </Button>
      {error ? (
        <p className="min-w-full shrink-0 basis-full text-left text-[10px] text-destructive">
          {error}
        </p>
      ) : null}
    </Fragment>
  );
}

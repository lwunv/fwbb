"use client";

import { useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/shared/inline-notice";
import { InfoRow } from "@/components/shared/info-row";
import {
  ShieldCheck,
  Loader2,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { formatVND, cn } from "@/lib/utils";
import { reconcileFund, type ReconcileReport } from "@/actions/reconcile-fund";

export function ReconcilePanel() {
  const t = useTranslations("fundAdmin");
  const locale = useLocale();
  const [report, setReport] = useState<ReconcileReport | null>(null);
  const [pending, start] = useTransition();

  function run() {
    start(async () => {
      const r = await reconcileFund();
      setReport(r);
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <ShieldCheck className="text-primary h-5 w-5" />
              {t("reconcileTitle")}
            </h2>
            <p className="text-muted-foreground text-sm">
              {t("reconcileSubtitle")}
            </p>
          </div>
          <Button
            type="button"
            onClick={run}
            disabled={pending}
            variant="outline"
            size="sm"
          >
            {pending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="mr-1 h-4 w-4" />
            )}
            {t("reconcileRunButton")}
          </Button>
        </div>

        {report && (
          <div className="space-y-3">
            <InlineNotice
              tone={report.ok ? "success" : "danger"}
              icon={report.ok ? CheckCircle2 : AlertTriangle}
            >
              <p className="font-semibold">
                {report.ok
                  ? t("reconcileBalanced")
                  : t("reconcileErrorsFound", {
                      count: report.issues.filter((i) => i.severity === "error")
                        .length,
                    })}
              </p>
              <p className="text-muted-foreground text-xs">
                {t("reconcileGeneratedAt", {
                  time: new Date(report.generatedAt).toLocaleString(
                    locale === "en" ? "en-US" : locale,
                  ),
                })}
              </p>
            </InlineNotice>

            <div className="grid gap-2 sm:grid-cols-2">
              <InfoRow
                label={t("reconcileTotalIn")}
                value={formatVND(report.totals.totalIn)}
              />
              <InfoRow
                label={t("reconcileTotalOut")}
                value={formatVND(report.totals.totalOut)}
              />
              <InfoRow
                label={t("reconcileTotalRefund")}
                value={formatVND(report.totals.totalRefund)}
              />
              <InfoRow
                label={t("reconcileBalanceFromTx")}
                value={formatVND(report.totals.netInternal)}
                valueClassName="text-primary"
              />
              <InfoRow
                label={t("reconcileSumPositive")}
                value={formatVND(report.totals.sumPositiveBalances)}
                valueClassName="text-green-600 dark:text-green-400"
              />
              <InfoRow
                label={t("reconcileSumNegative")}
                value={formatVND(report.totals.sumNegativeBalances)}
                valueClassName="text-destructive"
              />
            </div>

            <div className="text-muted-foreground text-xs">
              {t("reconcileNotifSummary", {
                matched: report.paymentNotifications.matched,
                pending: report.paymentNotifications.pending,
                orphanMatched: report.paymentNotifications.matchedWithoutTx,
                orphanTx: report.paymentNotifications.txReferencingMissingNotif,
              })}
            </div>

            {report.issues.length > 0 && (
              <ul className="space-y-1.5">
                {report.issues.map((i, idx) => (
                  <li
                    key={idx}
                    className={cn(
                      "rounded-lg border p-2 text-xs",
                      i.severity === "error"
                        ? "border-destructive/40 bg-destructive/5 text-destructive"
                        : "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300",
                    )}
                  >
                    <span className="font-mono uppercase">[{i.code}]</span>{" "}
                    {i.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

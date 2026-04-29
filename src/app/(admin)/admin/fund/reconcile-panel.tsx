"use client";

import { useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
            <div
              className={cn(
                "flex items-start gap-2 rounded-xl border p-3",
                report.ok
                  ? "border-green-500/40 bg-green-500/5"
                  : "border-destructive/40 bg-destructive/5",
              )}
            >
              {report.ok ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
              ) : (
                <AlertTriangle className="text-destructive mt-0.5 h-5 w-5 shrink-0" />
              )}
              <div className="min-w-0 flex-1 text-sm">
                <p
                  className={cn(
                    "font-semibold",
                    report.ok
                      ? "text-green-700 dark:text-green-300"
                      : "text-destructive",
                  )}
                >
                  {report.ok
                    ? t("reconcileBalanced")
                    : t("reconcileErrorsFound", {
                        count: report.issues.filter(
                          (i) => i.severity === "error",
                        ).length,
                      })}
                </p>
                <p className="text-muted-foreground text-xs">
                  {t("reconcileGeneratedAt", {
                    time: new Date(report.generatedAt).toLocaleString(
                      locale === "en" ? "en-US" : locale,
                    ),
                  })}
                </p>
              </div>
            </div>

            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <Row
                label={t("reconcileTotalIn")}
                value={report.totals.totalIn}
              />
              <Row
                label={t("reconcileTotalOut")}
                value={report.totals.totalOut}
              />
              <Row
                label={t("reconcileTotalRefund")}
                value={report.totals.totalRefund}
              />
              <Row
                label={t("reconcileBalanceFromTx")}
                value={report.totals.netInternal}
                accent="text-primary"
              />
              <Row
                label={t("reconcileSumPositive")}
                value={report.totals.sumPositiveBalances}
                accent="text-green-600 dark:text-green-400"
              />
              <Row
                label={t("reconcileSumNegative")}
                value={report.totals.sumNegativeBalances}
                accent="text-destructive"
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

function Row({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <div className="bg-muted/30 flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
      <span className="text-muted-foreground truncate">{label}</span>
      <strong className={cn("tabular-nums", accent)}>{formatVND(value)}</strong>
    </div>
  );
}

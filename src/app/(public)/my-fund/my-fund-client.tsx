"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { formatVND } from "@/lib/utils";
import { VietQRPayment } from "@/components/payment/vietqr-payment";
import {
  Wallet,
  ArrowUpCircle,
  ArrowDownCircle,
  RotateCcw,
  QrCode,
  Calendar,
} from "lucide-react";
import type { FundBalance } from "@/lib/fund-core";
import { format } from "date-fns";
import { getDateFnsLocale } from "@/lib/date-fns-locale";

interface FundTransaction {
  id: number;
  type: "fund_contribution" | "fund_deduction" | "fund_refund";
  amount: number;
  description: string | null;
  createdAt: string | null;
  session: { id: number; date: string } | null;
}

interface Props {
  balance: FundBalance;
  transactions: FundTransaction[];
}

export function MyFundClient({ balance, transactions }: Props) {
  const t = useTranslations("myFundClient");
  const locale = useLocale();
  const [showQR, setShowQR] = useState(false);
  const [customAmount, setCustomAmount] = useState<string>("500000");

  function formatDate(dateStr: string | null) {
    if (!dateStr) return "";
    try {
      return format(new Date(dateStr), "dd/MM/yyyy HH:mm", {
        locale: getDateFnsLocale(locale),
      });
    } catch {
      return dateStr;
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      {/* Header Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-card/80 relative overflow-hidden rounded-2xl border p-5 shadow-sm backdrop-blur"
      >
        <div className="absolute top-0 right-0 p-4 opacity-10">
          <Wallet className="h-24 w-24" />
        </div>

        <div className="relative z-10">
          <div className="mb-2 flex items-center gap-2">
            <Wallet className="text-primary h-5 w-5" />
            <h2 className="text-muted-foreground font-semibold">
              {t("myFund")}
            </h2>
          </div>
          <div className="mb-6">
            <span className="text-primary text-4xl font-bold">
              {formatVND(balance.balance)}
            </span>
            <p className="text-muted-foreground mt-1 text-sm">
              {t("currentBalance")}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 border-t pt-4">
            <div>
              <p className="text-muted-foreground mb-1 flex items-center gap-1 text-sm">
                <ArrowUpCircle className="h-3.5 w-3.5 text-green-500" />
                {t("contributed")}
              </p>
              <p className="text-base font-semibold">
                {formatVND(balance.totalContributions)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1 flex items-center gap-1 text-sm">
                <ArrowDownCircle className="h-3.5 w-3.5 text-orange-500" />
                {t("deducted")}
              </p>
              <p className="text-base font-semibold">
                {formatVND(balance.totalDeductions)}
              </p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Action: Top Up */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-card/80 space-y-3 rounded-2xl border p-4 shadow-sm backdrop-blur"
      >
        <h3 className="text-base font-semibold">{t("topUp")}</h3>
        <div className="flex gap-2">
          <input
            type="number"
            inputMode="numeric"
            value={customAmount}
            onChange={(e) => setCustomAmount(e.target.value)}
            placeholder={t("amountPlaceholder")}
            className="bg-background min-h-11 min-w-0 flex-1 rounded-xl border p-2.5 text-base"
            min={1000}
            step={1000}
            aria-label={t("topUp")}
          />
          <button
            onClick={() => setShowQR(true)}
            disabled={!customAmount || parseInt(customAmount, 10) <= 0}
            className="bg-primary text-primary-foreground flex min-h-11 items-center gap-2 rounded-xl px-4 font-medium whitespace-nowrap active:scale-[0.98] disabled:opacity-50"
          >
            <QrCode className="h-4 w-4" />
            {t("getQR")}
          </button>
        </div>
      </motion.div>

      {/* Transaction History */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-card/80 rounded-2xl border shadow-sm backdrop-blur"
      >
        <div className="flex items-center justify-between border-b p-4">
          <h3 className="font-semibold">{t("history")}</h3>
          <span className="text-muted-foreground text-sm">
            {t("txCount", { count: transactions.length })}
          </span>
        </div>

        <div className="max-h-[60vh] divide-y overflow-y-auto">
          {transactions.length === 0 ? (
            <div className="text-muted-foreground p-8 text-center">
              <p>{t("noTransactions")}</p>
            </div>
          ) : (
            transactions.map((tx) => (
              <div
                key={tx.id}
                className="flex items-start justify-between gap-4 p-4"
              >
                <div className="flex min-w-0 gap-3">
                  <div className="mt-0.5 shrink-0">
                    {tx.type === "fund_contribution" && (
                      <ArrowUpCircle className="h-5 w-5 text-green-500" />
                    )}
                    {tx.type === "fund_deduction" && (
                      <ArrowDownCircle className="h-5 w-5 text-orange-500" />
                    )}
                    {tx.type === "fund_refund" && (
                      <RotateCcw className="h-5 w-5 text-red-500" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-base font-medium">
                      {tx.type === "fund_contribution" && t("txContribution")}
                      {tx.type === "fund_deduction" && t("txDeduction")}
                      {tx.type === "fund_refund" && t("txRefund")}
                    </p>
                    <p className="text-muted-foreground mt-0.5 truncate text-sm">
                      {tx.description}
                    </p>
                    {tx.session && (
                      <p className="text-muted-foreground mt-1 flex items-center gap-1 text-sm">
                        <Calendar className="h-3 w-3" />{" "}
                        {t("session", { date: tx.session.date })}
                      </p>
                    )}
                    <p className="text-muted-foreground/70 mt-1 text-xs">
                      {formatDate(tx.createdAt)}
                    </p>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p
                    className={`font-bold ${tx.type === "fund_contribution" ? "text-green-500" : "text-foreground"}`}
                  >
                    {tx.type === "fund_contribution" ? "+" : "-"}
                    {formatVND(tx.amount)}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </motion.div>

      {/* VietQR Payment Sheet */}
      {showQR && (
        <VietQRPayment
          amount={parseInt(customAmount, 10) || 500000}
          memo={`FWBB QUY`}
          onClose={() => setShowQR(false)}
          title={t("qrTitle")}
          description={t("qrDescription")}
        />
      )}
    </div>
  );
}

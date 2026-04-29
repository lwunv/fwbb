"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { formatVND } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { PaymentQR } from "@/components/payment/payment-qr";
import {
  Wallet,
  ArrowUpCircle,
  ArrowDownCircle,
  RotateCcw,
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
  memberId: number;
}

export function MyFundClient({ balance, transactions, memberId }: Props) {
  const t = useTranslations("myFundClient");
  const locale = useLocale();
  const debtAmount = balance.balance < 0 ? Math.abs(balance.balance) : 0;
  const hasDebt = debtAmount > 0;
  const [mode, setMode] = useState<"contribute" | "payDebt">(
    hasDebt ? "payDebt" : "contribute",
  );
  const [customAmount, setCustomAmount] = useState<string>(
    hasDebt ? String(debtAmount) : "500000",
  );

  function pickMode(next: "contribute" | "payDebt") {
    setMode(next);
    if (next === "contribute") setCustomAmount("500000");
    else setCustomAmount(String(debtAmount || 0));
  }

  const formattedAmount = customAmount
    ? Number(customAmount).toLocaleString("vi-VN")
    : "";

  // Memo prefix matches the bank-matcher dispatch (see DebtFundTabs):
  //   "FWBB QUY <id>" → fund_contribution
  //   "FWBB NO  <id>" → debt repayment
  const qrAmount = Math.max(0, parseInt(customAmount, 10) || 0);
  const qrMemo =
    mode === "payDebt" ? `FWBB NO ${memberId}` : `FWBB QUY ${memberId}`;

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
      >
        <Card className="overflow-hidden">
          <CardContent className="relative p-5">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <Wallet className="h-24 w-24" />
            </div>

            <div className="relative z-10">
              <div className="mb-2 flex items-center gap-2">
                <Wallet
                  className={`h-5 w-5 ${
                    balance.balance < 0 ? "text-destructive" : "text-primary"
                  }`}
                />
                <h2 className="text-muted-foreground font-semibold">
                  {t("myFund")}
                </h2>
              </div>
              <div className="mb-6">
                <span
                  className={`text-4xl font-bold tabular-nums ${
                    balance.balance < 0
                      ? "text-destructive"
                      : balance.balance > 0
                        ? "text-primary"
                        : "text-muted-foreground"
                  }`}
                >
                  {formatVND(balance.balance)}
                </span>
                <p className="text-muted-foreground mt-1 text-sm">
                  {balance.balance < 0
                    ? "Đang nợ quỹ"
                    : balance.balance > 0
                      ? t("currentBalance")
                      : "Quỹ đã hết"}
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
          </CardContent>
        </Card>
      </motion.div>

      {/* Action: Top Up */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <Card>
          <CardContent className="space-y-3 p-4">
            <h3 className="text-base font-semibold">{t("topUp")}</h3>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => pickMode("contribute")}
                className={`flex min-h-14 items-start gap-2 rounded-xl border p-3 text-left transition-colors ${
                  mode === "contribute"
                    ? "border-primary bg-primary/5 ring-primary/30 ring-1"
                    : "border-border bg-background hover:bg-muted/50"
                }`}
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    mode === "contribute"
                      ? "border-primary bg-primary"
                      : "border-muted-foreground"
                  }`}
                >
                  {mode === "contribute" && (
                    <span className="h-1.5 w-1.5 rounded-full bg-white" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">Nộp quỹ</span>
                  <span className="text-muted-foreground block text-xs">
                    Mặc định 500.000
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => pickMode("payDebt")}
                disabled={!hasDebt}
                className={`flex min-h-14 items-start gap-2 rounded-xl border p-3 text-left transition-colors ${
                  mode === "payDebt" && hasDebt
                    ? "border-destructive bg-destructive/5 ring-destructive/30 ring-1"
                    : "border-border bg-background hover:bg-muted/50"
                } disabled:opacity-50`}
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    mode === "payDebt" && hasDebt
                      ? "border-destructive bg-destructive"
                      : "border-muted-foreground"
                  }`}
                >
                  {mode === "payDebt" && hasDebt && (
                    <span className="h-1.5 w-1.5 rounded-full bg-white" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">
                    Thanh toán nợ
                  </span>
                  <span
                    className={`block text-xs ${
                      hasDebt
                        ? "text-destructive font-semibold tabular-nums"
                        : "text-muted-foreground"
                    }`}
                  >
                    {hasDebt ? `Nợ ${formatVND(debtAmount)}` : "Không có nợ"}
                  </span>
                </span>
              </button>
            </div>

            <input
              type="text"
              inputMode="numeric"
              value={formattedAmount}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "");
                setCustomAmount(digits);
              }}
              placeholder={t("amountPlaceholder")}
              className="bg-background min-h-11 w-full min-w-0 rounded-xl border p-2.5 text-base tabular-nums"
              aria-label={t("topUp")}
            />

            {qrAmount > 0 && (
              <PaymentQR variant="inline" amount={qrAmount} memo={qrMemo} />
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Transaction History */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <Card className="overflow-hidden">
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
        </Card>
      </motion.div>
    </div>
  );
}

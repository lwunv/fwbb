"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { formatK } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { NumberStepper } from "@/components/ui/number-stepper";
import { PaymentQR } from "@/components/payment/payment-qr";

/** Bước ±50K cho ô nhập tiền nạp quỹ. */
const TOPUP_STEP = 50_000;
/** Số tiền nộp quỹ mặc định — cũng là ngưỡng so sánh với nợ để chọn mode
 *  mặc định (xem defaultToDebt bên dưới). */
const DEFAULT_CONTRIBUTE_AMOUNT = 500_000;

interface Props {
  memberId: number;
  /** Số tiền đang nợ (>0 → bật tab "Thanh toán nợ", default amount = debt). */
  debtAmount: number;
  /** Bỏ wrapper Card khi nhúng vào component khác (vd: banner expand panel). */
  bare?: boolean;
}

/**
 * Card "Nạp thêm vào quỹ" — mode picker (Nộp quỹ / Thanh toán nợ) + amount
 * input + QR inline. Bank-matcher dispatch theo memo prefix:
 *   "FWBB QUY <id>" → fund_contribution
 *   "FWBB NO  <id>" → debt repayment
 *
 * Dùng chung giữa /my-fund (full page) và `FundBalanceBanner` (expand panel
 * trên home), nên 1 nguồn truth duy nhất cho mode → memo → amount.
 */
export function FundTopUpCard({ memberId, debtAmount, bare = false }: Props) {
  const t = useTranslations("myFundClient");
  const hasDebt = debtAmount > 0;
  // Mặc định vẫn chọn "Nộp quỹ" kể cả đang nợ — chỉ mặc định "Thanh toán nợ"
  // khi nợ VƯỢT mức nộp quỹ mặc định (nợ lớn hơn thì ưu tiên trả nợ trước).
  // Quyết định 2026-07-06.
  const defaultToDebt = hasDebt && debtAmount > DEFAULT_CONTRIBUTE_AMOUNT;

  const [mode, setMode] = useState<"contribute" | "payDebt">(
    defaultToDebt ? "payDebt" : "contribute",
  );
  const [amount, setAmount] = useState<number>(
    defaultToDebt ? debtAmount : DEFAULT_CONTRIBUTE_AMOUNT,
  );

  function pickMode(next: "contribute" | "payDebt") {
    setMode(next);
    setAmount(
      next === "contribute" ? DEFAULT_CONTRIBUTE_AMOUNT : debtAmount || 0,
    );
  }

  const qrAmount = Math.max(0, amount);
  const qrMemo =
    mode === "payDebt" ? `FWBB NO ${memberId}` : `FWBB QUY ${memberId}`;

  const body = (
    <div className="space-y-3" data-tour="fund-topup">
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
            <span className="block text-sm font-semibold">
              {t("topupContribute")}
            </span>
            <span className="text-muted-foreground block text-xs">
              {t("topupContributeHint")}
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
              {t("topupPayDebt")}
            </span>
            <span
              className={`block text-sm ${
                hasDebt
                  ? "text-destructive font-semibold tabular-nums"
                  : "text-muted-foreground"
              }`}
            >
              {hasDebt
                ? t("topupOwes", { amount: formatK(debtAmount) })
                : t("topupNoDebt")}
            </span>
          </span>
        </button>
      </div>

      {/* −/+ stepper (bước 50K) + vẫn gõ tay được; format vi-VN. */}
      <NumberStepper
        value={amount}
        onChange={setAmount}
        step={TOPUP_STEP}
        min={0}
        displayFormat="vnd"
        className="flex w-full"
      />

      {qrAmount > 0 && (
        <PaymentQR variant="inline" amount={qrAmount} memo={qrMemo} />
      )}
    </div>
  );

  if (bare) return body;

  return (
    <Card>
      <CardContent className="p-4">{body}</CardContent>
    </Card>
  );
}

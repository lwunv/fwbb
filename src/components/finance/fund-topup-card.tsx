"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { formatVND } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { PaymentQR } from "@/components/payment/payment-qr";

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
  const qrAmount = Math.max(0, parseInt(customAmount, 10) || 0);
  const qrMemo =
    mode === "payDebt" ? `FWBB NO ${memberId}` : `FWBB QUY ${memberId}`;

  const body = (
    <div className="space-y-3">
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
            <span className="block text-sm font-semibold">Thanh toán nợ</span>
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
    </div>
  );

  if (bare) return body;

  return (
    <Card>
      <CardContent className="p-4">{body}</CardContent>
    </Card>
  );
}

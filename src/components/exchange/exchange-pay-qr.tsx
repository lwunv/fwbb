"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy } from "lucide-react";
import { getVietQRUrl } from "@/lib/vietqr";

/**
 * QR chuyển khoản tới tài khoản của host. Cố tình không dùng `PaymentQR` của
 * quỹ nhóm: tiền giao lưu đi thẳng cho host, không qua sổ quỹ. `amount` do
 * server tính (`remaining` hoặc tiền cọc), component này chỉ hiển thị.
 */
export function ExchangePayQR({
  bankBin,
  accountNo,
  accountName,
  amount,
  memo,
}: {
  bankBin: string;
  accountNo: string;
  accountName: string;
  amount: number;
  memo: string;
}) {
  const t = useTranslations("exchange.event");
  const [copied, setCopied] = useState(false);

  async function copyMemo() {
    try {
      await navigator.clipboard.writeText(memo);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Trình duyệt chặn clipboard (WebView): người dùng vẫn đọc được nội dung ngay trên màn hình.
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={getVietQRUrl({ bankBin, accountNo, accountName, amount, memo })}
        alt={t("qrAlt")}
        width={240}
        height={240}
        className="h-auto w-full max-w-60 rounded-xl border bg-white"
      />
      <p className="text-muted-foreground text-center text-base break-words">
        {t("accountLine", { name: accountName, number: accountNo })}
      </p>
      <p className="bg-muted rounded-lg px-3 py-2 font-mono text-base break-all">
        {memo}
      </p>
      <button
        type="button"
        onClick={copyMemo}
        className="bg-secondary text-secondary-foreground inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-base font-medium"
      >
        {copied ? (
          <Check className="h-4 w-4" aria-hidden />
        ) : (
          <Copy className="h-4 w-4" aria-hidden />
        )}
        {copied ? t("copied") : t("copyMemo")}
      </button>
    </div>
  );
}

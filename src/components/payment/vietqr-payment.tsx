"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getVietQRUrl } from "@/lib/vietqr";
import { formatVND } from "@/lib/utils";
import { QrCode, Copy, Check, X, CreditCard, Banknote } from "lucide-react";

interface VietQRPaymentProps {
  /** Amount in VND (integer) */
  amount: number;
  /** Transfer memo */
  memo: string;
  /** Callback when user closes the payment sheet */
  onClose: () => void;
  /** Optional: title override */
  title?: string;
  /** Optional: subtitle / description */
  description?: string;
}

const BANK_BIN = process.env.NEXT_PUBLIC_TIMO_BANK_BIN ?? "970454";
const ACCOUNT_NO = process.env.NEXT_PUBLIC_TIMO_ACCOUNT_NO ?? "";
const ACCOUNT_NAME = process.env.NEXT_PUBLIC_TIMO_ACCOUNT_NAME ?? "";

export function VietQRPayment({
  amount,
  memo,
  onClose,
  title = "Chuyển khoản",
  description,
}: VietQRPaymentProps) {
  const [copied, setCopied] = useState<string | null>(null);

  const qrUrl = useMemo(
    () =>
      getVietQRUrl({
        bankBin: BANK_BIN,
        accountNo: ACCOUNT_NO,
        accountName: ACCOUNT_NAME,
        amount,
        memo,
      }),
    [amount, memo],
  );

  async function copyToClipboard(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Fallback for in-app browsers
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    }
  }

  const copyItems = [
    { label: "STK", value: ACCOUNT_NO, icon: CreditCard },
    { label: "Số tiền", value: String(amount), icon: Banknote },
    { label: "Nội dung", value: memo, icon: QrCode },
  ];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: "100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "100%", opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="bg-card max-h-[90vh] w-full overflow-y-auto rounded-t-2xl shadow-2xl sm:max-w-md sm:rounded-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="bg-card/95 sticky top-0 z-10 flex items-center justify-between rounded-t-2xl border-b px-5 py-4 backdrop-blur-sm">
            <div>
              <h3 className="text-lg font-bold">{title}</h3>
              {description && (
                <p className="text-muted-foreground mt-0.5 text-sm">
                  {description}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="hover:bg-accent rounded-full p-2 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* QR Code */}
          <div className="px-5 py-6">
            <div className="mx-auto max-w-[280px] rounded-2xl bg-white p-4 shadow-md">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrUrl}
                alt={`VietQR thanh toán ${formatVND(amount)}`}
                className="h-auto w-full rounded-lg"
                loading="eager"
              />
            </div>

            {/* Amount highlight */}
            <div className="mt-4 text-center">
              <p className="text-primary text-3xl font-bold">
                {formatVND(amount)}
              </p>
              <p className="text-muted-foreground mt-1 text-sm">
                Quét mã QR bằng app ngân hàng bất kỳ
              </p>
            </div>
          </div>

          {/* Transfer details */}
          <div className="space-y-3 px-5 pb-5">
            <div className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">
              Thông tin chuyển khoản
            </div>

            {/* Bank info */}
            <div className="bg-muted/30 space-y-3 rounded-xl border p-4">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-sm">Ngân hàng</span>
                <span className="text-sm font-medium">Timo (VPBank)</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-sm">Chủ TK</span>
                <span className="text-sm font-medium">{ACCOUNT_NAME}</span>
              </div>
            </div>

            {/* Copyable fields */}
            {copyItems.map(({ label, value, icon: Icon }) => (
              <button
                key={label}
                onClick={() => copyToClipboard(value, label)}
                className="hover:bg-accent/50 group flex w-full items-center justify-between rounded-xl border p-3 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Icon className="text-muted-foreground h-4 w-4" />
                  <div className="text-left">
                    <p className="text-muted-foreground text-xs">{label}</p>
                    <p className="font-mono text-sm font-medium">
                      {label === "Số tiền"
                        ? formatVND(parseInt(value, 10))
                        : value}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-xs">
                  {copied === label ? (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="flex items-center gap-1 text-green-500"
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span>Đã copy</span>
                    </motion.div>
                  ) : (
                    <span className="text-muted-foreground flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                      <Copy className="h-3.5 w-3.5" />
                      Copy
                    </span>
                  )}
                </div>
              </button>
            ))}

            {/* Warning */}
            <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
              <p className="text-xs text-amber-700 dark:text-amber-400">
                ⚠️ Nhập <strong>đúng nội dung chuyển khoản</strong> để hệ thống
                tự động xác nhận. Nếu nhập sai, admin sẽ xác nhận thủ công.
              </p>
            </div>
          </div>

          {/* Bottom safe area */}
          <div className="h-6 sm:hidden" />
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

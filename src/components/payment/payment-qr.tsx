"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Copy,
  Check,
  Banknote,
  FileText,
  X,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { getVietQRUrl } from "@/lib/vietqr";
import { formatVND } from "@/lib/utils";
import { subscribePayment } from "@/lib/payment-poller";
import { toast } from "sonner";

interface PaymentQRProps {
  /** Số tiền chuyển khoản (VND, integer) */
  amount: number;
  /** Nội dung chuyển khoản — bắt buộc đúng để webhook tự động match */
  memo: string;
  /** Render mode: inline (mặc định) hoặc overlay sheet */
  variant?: "inline" | "overlay";
  /** Title (chỉ overlay) */
  title?: string;
  /** Mô tả phụ (chỉ overlay) */
  description?: string;
  /** Callback khi user bấm đóng (chỉ overlay) hoặc khi payment được nhận */
  onClose?: () => void;
  /** Callback khi phát hiện payment qua Gmail Pub/Sub */
  onPaymentReceived?: (info: {
    amount?: number;
    matched: boolean;
    transferContent?: string;
  }) => void;
  /** Tắt auto-detect (mặc định bật) */
  disablePolling?: boolean;
  /** Hiện compact (ẩn STK row trong inline mode) */
  compact?: boolean;
}

const BANK_BIN = process.env.NEXT_PUBLIC_TIMO_BANK_BIN ?? "970454";
const ACCOUNT_NO = process.env.NEXT_PUBLIC_TIMO_ACCOUNT_NO ?? "";
const ACCOUNT_NAME = process.env.NEXT_PUBLIC_TIMO_ACCOUNT_NAME ?? "";

export function PaymentQR({
  amount,
  memo,
  variant = "inline",
  title,
  description,
  onClose,
  onPaymentReceived,
  disablePolling = false,
  compact = false,
}: PaymentQRProps) {
  const tF = useTranslations("finance");
  const usedTitle = title ?? tF("bankTransfer");
  const [copied, setCopied] = useState<string | null>(null);
  const [paymentReceived, setPaymentReceived] = useState(false);
  const [paymentMatched, setPaymentMatched] = useState(false);
  const router = useRouter();
  const firedRef = useRef(false);

  // Clear the stale "received" banner when the (memo, amount) target changes
  // (e.g. the user switches top-up amount in the same mounted card). Done during
  // render, not an effect, to satisfy the no-set-state-in-effect rule and reset
  // before paint. The one-shot `firedRef` guard is reset in the polling effect
  // below, which re-runs on the same dependency change.
  const subKey = `${memo}|${amount}`;
  const [prevSubKey, setPrevSubKey] = useState(subKey);
  if (subKey !== prevSubKey) {
    setPrevSubKey(subKey);
    setPaymentReceived(false);
    setPaymentMatched(false);
  }

  const qrUrl = useMemo(
    () =>
      getVietQRUrl({
        bankBin: BANK_BIN,
        accountNo: ACCOUNT_NO,
        accountName: ACCOUNT_NAME,
        amount,
        memo,
        template: variant === "overlay" ? "compact2" : "qr_only",
      }),
    [amount, memo, variant],
  );

  // ─── Real-time payment detection via Gmail Pub/Sub ───
  // Subscribes to a process-wide singleton poller so N PaymentQR instances
  // on the same page share ONE polling loop. Webhook
  // /api/webhooks/gmail/route.ts populates payment_notifications when a Timo
  // email arrives; checkPaymentForMemo (server action) reads that table.
  useEffect(() => {
    if (disablePolling || amount <= 0 || !memo) return;

    // New (memo, amount) subscription → clear the one-shot guard so a real
    // payment for the new memo isn't swallowed by a previous fire.
    firedRef.current = false;

    const unsubscribe = subscribePayment(memo, (status) => {
      if (firedRef.current) return;
      if (!status.received) return;

      firedRef.current = true;
      setPaymentReceived(true);
      setPaymentMatched(status.matched);
      onPaymentReceived?.({
        amount: status.amount,
        matched: status.matched,
        transferContent: status.transferContent,
      });
      toast.success(
        status.matched
          ? tF("qrToastMatched", { amount: formatVND(status.amount ?? amount) })
          : tF("qrToastReceived"),
      );
      router.refresh();
    });

    return unsubscribe;
  }, [memo, amount, disablePolling, onPaymentReceived, router]);

  const copy = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(label);
    setTimeout(() => setCopied(null), 1800);
  }, []);

  // CopyRow / StatusBanner moved out of the render body — `react-hooks` rules
  // forbid creating a new component identity on every render (each call would
  // mount a fresh subtree, killing animations + losing focus).

  const banner = (
    <StatusBanner
      paymentReceived={paymentReceived}
      paymentMatched={paymentMatched}
      disablePolling={disablePolling}
    />
  );

  const renderRow = (props: {
    label: string;
    value: string;
    icon: typeof Banknote;
    display?: string;
  }) => (
    <CopyRow
      {...props}
      copied={copied}
      onCopy={(v, l) => copy(v, l)}
      ariaLabel={tF("qrCopyAria", {
        label: props.label,
        value: props.display ?? props.value,
      })}
    />
  );

  // ─── INLINE MODE ───
  if (variant === "inline") {
    return (
      <div className="bg-muted/30 space-y-2 rounded-xl border p-3">
        <div className="flex items-start gap-3">
          <div className="shrink-0 rounded-lg bg-white p-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrUrl}
              alt={`VietQR ${formatVND(amount)}`}
              width={120}
              height={120}
              className="block h-[120px] w-[120px] rounded"
              loading="lazy"
            />
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            {renderRow({
              label: tF("qrAmount"),
              value: String(amount),
              icon: Banknote,
              display: formatVND(amount),
            })}
            {renderRow({
              label: tF("qrContent"),
              value: memo,
              icon: FileText,
            })}
            {!compact &&
              renderRow({
                label: tF("qrAccountTimo"),
                value: ACCOUNT_NO,
                icon: Banknote,
                display: ACCOUNT_NO,
              })}
          </div>
        </div>
        {/* Cảnh báo nội dung CK — trong overlay mode đã có nhưng inline mode
            (hay được dùng từ DebtCard / DebtFundTabs) trước đây không hiện,
            khiến user gõ tay sai memo và auto-match webhook fail. */}
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-2">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            ⚠️{" "}
            {tF.rich("qrMemoWarning", {
              b: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
        </div>
        {banner}
      </div>
    );
  }

  // ─── OVERLAY MODE ───
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
              <h3 className="text-lg font-bold">{usedTitle}</h3>
              {description && (
                <p className="text-muted-foreground mt-0.5 text-sm">
                  {description}
                </p>
              )}
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="hover:bg-accent rounded-full p-2 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>

          <div className="px-5 py-6">
            <div className="mx-auto max-w-[280px] rounded-2xl bg-white p-4 shadow-md">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrUrl}
                alt={`VietQR ${formatVND(amount)}`}
                className="h-auto w-full rounded-lg"
                loading="eager"
              />
            </div>
            <div className="mt-4 text-center">
              <p className="text-primary text-3xl font-bold">
                {formatVND(amount)}
              </p>
              <p className="text-muted-foreground mt-1 text-sm">
                {tF("qrScanHint")}
              </p>
            </div>
            <div className="mt-3">{banner}</div>
          </div>

          <div className="space-y-2 px-5 pb-5">
            <div className="bg-muted/30 space-y-3 rounded-xl border p-4">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-sm">
                  {tF("qrBank")}
                </span>
                <span className="text-sm font-medium">Timo (VPBank)</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-sm">
                  {tF("qrAccountHolder")}
                </span>
                <span className="text-sm font-medium">{ACCOUNT_NAME}</span>
              </div>
            </div>
            {renderRow({
              label: tF("qrAccountShort"),
              value: ACCOUNT_NO,
              icon: Banknote,
            })}
            {renderRow({
              label: tF("qrAmount"),
              value: String(amount),
              icon: Banknote,
              display: formatVND(amount),
            })}
            {renderRow({
              label: tF("qrContent"),
              value: memo,
              icon: FileText,
            })}
            <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
              <p className="text-xs text-amber-700 dark:text-amber-400">
                ⚠️{" "}
                {tF.rich("qrMemoWarningLong", {
                  b: (chunks) => <strong>{chunks}</strong>,
                })}
              </p>
            </div>
          </div>
          <div className="h-6 sm:hidden" />
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Subcomponents (module-level so they keep stable identity across renders) ───

function StatusBanner({
  paymentReceived,
  paymentMatched,
  disablePolling,
}: {
  paymentReceived: boolean;
  paymentMatched: boolean;
  disablePolling: boolean;
}) {
  const tF = useTranslations("finance");
  if (paymentReceived) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className={`flex items-center justify-center gap-2 rounded-lg p-2 text-sm font-medium ${
          paymentMatched
            ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
            : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
        }`}
      >
        <CheckCircle2 className="h-4 w-4" />
        {paymentMatched ? tF("qrReceivedMatched") : tF("qrReceivedUnmatched")}
      </motion.div>
    );
  }
  if (disablePolling) return null;
  return (
    <div className="text-muted-foreground flex items-center justify-center gap-1.5 text-sm">
      <Loader2 className="h-3 w-3 animate-spin" />
      <span>{tF("qrWaiting")}</span>
    </div>
  );
}

function CopyRow({
  label,
  value,
  icon: Icon,
  display,
  copied,
  onCopy,
  ariaLabel,
}: {
  label: string;
  value: string;
  icon: typeof Banknote;
  display?: string;
  copied: string | null;
  onCopy: (value: string, label: string) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onCopy(value, label)}
      className="hover:bg-accent/50 flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left transition-colors"
      aria-label={ariaLabel}
    >
      <span className="flex items-center gap-1.5 text-xs">
        <Icon className="text-muted-foreground h-3.5 w-3.5" />
        <span className="text-muted-foreground">{label}</span>
      </span>
      <span className="flex items-center gap-1">
        <span className="font-mono text-sm font-medium">
          {display ?? value}
        </span>
        {copied === label ? (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="text-green-500"
          >
            <Check className="h-3.5 w-3.5" />
          </motion.span>
        ) : (
          <Copy className="text-muted-foreground h-3 w-3" />
        )}
      </span>
    </button>
  );
}

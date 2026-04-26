/**
 * VietQR utility — generates QR code URLs for Vietnamese bank transfers.
 *
 * Uses the VietQR API (img.vietqr.io) to generate QR images that
 * can be scanned by any Vietnamese banking app.
 *
 * Format: https://img.vietqr.io/image/{bankBin}-{accountNo}-compact2.png?amount=X&addInfo=Y&accountName=Z
 */

const VIETQR_BASE = "https://img.vietqr.io/image";

export interface VietQROptions {
  /** Bank BIN code (e.g. 970454 for Timo/VPBank) */
  bankBin: string;
  /** Recipient account number */
  accountNo: string;
  /** Recipient account name */
  accountName: string;
  /** Transfer amount in VND (integer) */
  amount: number;
  /** Transfer memo / content */
  memo: string;
  /** QR template: compact, compact2, qr_only, print */
  template?: "compact" | "compact2" | "qr_only" | "print";
}

/**
 * Generate a VietQR image URL for a bank transfer.
 */
export function getVietQRUrl(options: VietQROptions): string {
  const template = options.template ?? "compact2";
  const base = `${VIETQR_BASE}/${options.bankBin}-${options.accountNo}-${template}.png`;

  const params = new URLSearchParams();
  if (options.amount > 0) params.set("amount", String(options.amount));
  if (options.memo) params.set("addInfo", options.memo);
  if (options.accountName) params.set("accountName", options.accountName);

  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/**
 * Generate a VietQR URL for FWBB payments using configured Timo account.
 * Reads bank info from environment variables.
 */
export function getFWBBPaymentQRUrl(amount: number, memo: string): string {
  return getVietQRUrl({
    bankBin: process.env.NEXT_PUBLIC_TIMO_BANK_BIN ?? "970454",
    accountNo: process.env.NEXT_PUBLIC_TIMO_ACCOUNT_NO ?? "",
    accountName: process.env.NEXT_PUBLIC_TIMO_ACCOUNT_NAME ?? "",
    amount,
    memo,
  });
}

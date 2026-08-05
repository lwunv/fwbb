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
  /** Bank BIN code (e.g. 970454 for Timo/VietCapitalBank, i.e. BVBank) */
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
  // encodeURIComponent là lớp phòng thủ thứ hai: đường ghi từ trang Cài đặt đã
  // có zod chặn (BIN khớp danh bạ, accountNo khớp ^\d{6,20}$), nhưng đường lùi
  // về biến môi trường (NEXT_PUBLIC_TIMO_*) không qua schema nào — một giá trị
  // env chứa "/", "?" hay "#" sẽ làm vỡ path/query của URL ảnh QR nếu không
  // encode ở đây.
  const base = `${VIETQR_BASE}/${encodeURIComponent(options.bankBin)}-${encodeURIComponent(options.accountNo)}-${template}.png`;

  const params = new URLSearchParams();
  if (options.amount > 0) params.set("amount", String(options.amount));
  if (options.memo) params.set("addInfo", options.memo);
  if (options.accountName) params.set("accountName", options.accountName);

  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

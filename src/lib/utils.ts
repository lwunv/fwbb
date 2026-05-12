import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatVND(amount: number): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function roundToThousand(amount: number): number {
  return Math.ceil(amount / 1000) * 1000;
}

/**
 * Format integer VND với vi-VN thousand separators (dấu chấm), KHÔNG round,
 * KHÔNG kèm "₫"/"VND". Caller tự thêm suffix nếu cần.
 *
 * Examples: `formatK(214000)` → "214.000", `formatK(330000)` → "330.000",
 * `formatK(217500)` → "217.500". Trước đây hàm này round UP-to-1k để "bảo
 * vệ" admin khỏi underpay, nhưng việc đó đã làm ở layer cost-calculator
 * (`roundToThousand` trong `calculateSessionCosts`). Round 2 lần ở display
 * gây drift khi hiển thị ledger amounts (vd fund_contribution 217.500 →
 * display 218.000 trong khi DB lưu chính xác 217.500). Giờ pure format,
 * round chỉ ở chỗ tính cost, không lặp.
 *
 * Name giữ là `formatK` vì 27+ call-sites đã quen — đổi tên = noise.
 */
export function formatK(amount: number): string {
  return amount.toLocaleString("vi-VN");
}

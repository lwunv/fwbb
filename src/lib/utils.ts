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
 * Format amount as integer VND with vi-VN thousand separators (dots), rounded
 * UP to nearest 1k (financial safety — admin không bao giờ bị thiệt).
 *
 * Examples: `formatK(214000)` → "214.000", `formatK(24555)` → "25.000",
 * `formatK(330000)` → "330.000". Không kèm hậu tố "đ"/"VND" để dùng linh
 * hoạt — caller tự thêm nếu cần.
 *
 * Name giữ là `formatK` vì semantic round-UP-to-K không đổi, chỉ display
 * form đổi từ "330k" → "330.000" để dễ đọc khi số lớn (yêu cầu UX
 * 2026-05-12).
 */
export function formatK(amount: number): string {
  const rounded = Math.ceil(amount / 1000) * 1000;
  return rounded.toLocaleString("vi-VN");
}

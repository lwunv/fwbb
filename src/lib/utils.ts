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
  // Sign-preserving round-up-magnitude: for positive amounts behaves as before
  // (rounds up to next 1K so admin isn't underpaid). For negative deltas
  // (refunds, reversals) keeps the sign instead of silently flooring to 0.
  if (amount === 0) return 0;
  const sign = amount < 0 ? -1 : 1;
  return sign * Math.ceil(Math.abs(amount) / 1000) * 1000;
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

/**
 * Format một CHUỖI CHỮ SỐ thô thành kiểu Việt: "100000" → "100.000".
 *
 * Khác `formatK` ở chỗ nhận string chứ không nhận number, nên dùng được cho ô
 * nhập liệu: state giữ nguyên chuỗi chữ số người dùng gõ (kể cả chuỗi rỗng khi
 * họ xoá trắng), display thì có dấu chấm. Đi `Number()` qua lại mỗi lần gõ sẽ
 * làm rỗng biến thành 0 và nuốt số 0 đứng đầu.
 *
 * Bỏ qua mọi ký tự không phải chữ số, nên paste "200.000đ" hay "200 000" đều ra
 * "200.000".
 */
export function formatDigitsVi(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return "";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Lấy phần chữ số của một chuỗi người dùng gõ/paste. "200.000đ" → "200000". */
export function onlyDigits(raw: string): string {
  return raw.replace(/[^\d]/g, "");
}

/**
 * Chuẩn hoá text tiếng Việt cho tìm kiếm: lowercase + bỏ dấu (NFD tách dấu
 * kết hợp rồi xoá) + đổi đ→d + gộp khoảng trắng. Cho phép gõ "phieu" khớp
 * "Phiêu", "DUONG" khớp "Dương". Dùng cho search phía client (member list…).
 */
export function normalizeVietnamese(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // bỏ dấu kết hợp
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ")
    .trim();
}

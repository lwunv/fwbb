import type { FeeDisplay } from "@/lib/exchange/public-event";
import type { HeadRates } from "@/lib/exchange-fee";

/**
 * Mức phí mỗi đầu người để hiển thị. Chỉ chọn số có sẵn từ server (không có
 * công thức chia mới ở client): ước tính với buổi chia phí, số đã chốt với buổi
 * đã chốt.
 */
export function displayRates(fee: FeeDisplay): HeadRates {
  if (fee.kind === "fixed") return { male: fee.male, female: fee.female };
  if (fee.kind === "split") return fee.estimate;
  return fee.rates;
}

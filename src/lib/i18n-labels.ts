/**
 * Centralized locale-aware month labels. Trước đây pattern này được copy-paste
 * 2 chỗ với 2 variant khác nhau (dashboard dùng "Th1..Th12", court-rent dùng
 * "T1..T12"). Giờ shared — caller chọn variant phù hợp với UI density.
 *
 * Locale fallback: nếu locale không match (vd "ja"), trả về vi labels.
 */

type Locale = "vi" | "en" | "zh" | string;

/** "T1, T2, ..., T12" — short variant cho UI dense (court-rent grid). */
const SHORT_LABELS: Record<string, string[]> = {
  vi: [
    "T1",
    "T2",
    "T3",
    "T4",
    "T5",
    "T6",
    "T7",
    "T8",
    "T9",
    "T10",
    "T11",
    "T12",
  ],
  en: [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ],
  zh: [
    "1月",
    "2月",
    "3月",
    "4月",
    "5月",
    "6月",
    "7月",
    "8月",
    "9月",
    "10月",
    "11月",
    "12月",
  ],
};

/** "Th1, Th2, ..., Th12" — Vietnamese alternative dùng ở dashboard. */
const LONG_VI_LABELS = [
  "Th1",
  "Th2",
  "Th3",
  "Th4",
  "Th5",
  "Th6",
  "Th7",
  "Th8",
  "Th9",
  "Th10",
  "Th11",
  "Th12",
];

/**
 * Trả về month labels array (12 phần tử, index 0 = January) theo locale.
 * @param locale "vi" | "en" | "zh" | other
 * @param variant "short" (T1..T12 cho vi, Jan..Dec cho en) hoặc "long-vi"
 *   ("Th1..Th12") — chỉ áp dụng khi locale='vi'. en/zh giữ short variant
 *   vì không có biến thể dài hơn.
 */
export function getMonthLabels(
  locale: Locale,
  variant: "short" | "long-vi" = "short",
): string[] {
  if (variant === "long-vi" && locale === "vi") return [...LONG_VI_LABELS];
  return [...(SHORT_LABELS[locale] ?? SHORT_LABELS.vi)];
}

import type { ExchangeCard } from "@/lib/exchange/public-event";
import { formatVND } from "@/lib/utils";

/** "80K" khi tròn nghìn, còn lại hiện đủ số tiền. */
export function shortMoney(amount: number): string {
  return amount % 1000 === 0 ? `${amount / 1000}K` : formatVND(amount);
}

/** Việt Nam cố định UTC+7, không đổi giờ mùa hè. */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

const WEEKDAYS: Record<string, readonly string[]> = {
  vi: ["CN", "T2", "T3", "T4", "T5", "T6", "T7"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  zh: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"],
};

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Giờ Việt Nam của một mốc ISO, đọc qua getUTC* sau khi cộng +7. */
function vnParts(iso: string) {
  const d = new Date(new Date(iso).getTime() + VN_OFFSET_MS);
  return {
    weekday: d.getUTCDay(),
    day: pad2(d.getUTCDate()),
    month: pad2(d.getUTCMonth() + 1),
    time: `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`,
  };
}

/**
 * "T2, 09/11, 19:00-21:00" theo giờ Việt Nam, bất kể múi giờ máy.
 *
 * Dựng từ bảng cố định thay vì Intl: dữ liệu ICU của Node và trình duyệt
 * viết thứ khác nhau ("Th 4" và "Thứ 4"), mà thẻ giao lưu render cả ở server
 * nên lệch chữ là lệch hydrate.
 */
export function exchangeWhenLabel(
  startAt: string,
  endAt: string,
  locale: string,
): string {
  const s = vnParts(startAt);
  const e = vnParts(endAt);
  const lang = locale.split("-")[0];
  const names = WEEKDAYS[lang] ?? WEEKDAYS.vi;
  const wd = names[s.weekday];
  const day =
    lang === "en"
      ? `${wd}, ${s.month}/${s.day}`
      : lang === "zh"
        ? `${s.month}/${s.day} ${wd}`
        : `${wd}, ${s.day}/${s.month}`;
  return `${day}, ${s.time}-${e.time}`;
}

/** Chữ phí hiện trên thẻ giao lưu; `t` là bản dịch của `exchange.search`. */
export function exchangeFeeText(
  fee: ExchangeCard["fee"],
  t: (
    key: "feeGender" | "feeCap" | "feeAbout" | "feeLocked",
    values: Record<string, string>,
  ) => string,
): string {
  if (fee.kind === "fixed") {
    return fee.male === fee.female
      ? shortMoney(fee.male)
      : t("feeGender", {
          male: shortMoney(fee.male),
          female: shortMoney(fee.female),
        });
  }
  if (fee.kind === "split") {
    const amount = shortMoney(fee.estimate.male);
    return t(fee.estimateIsCap ? "feeCap" : "feeAbout", { amount });
  }
  return t("feeLocked", { amount: shortMoney(fee.rates.male) });
}

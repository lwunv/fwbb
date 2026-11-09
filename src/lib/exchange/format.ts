import type { ExchangeCard } from "@/lib/exchange/public-event";
import { formatVND } from "@/lib/utils";

const VN_TZ = "Asia/Ho_Chi_Minh";

/** "80K" khi tròn nghìn, còn lại hiện đủ số tiền. */
export function shortMoney(amount: number): string {
  return amount % 1000 === 0 ? `${amount / 1000}K` : formatVND(amount);
}

/** "T2, 19:00-21:00" theo giờ Việt Nam, bất kể múi giờ máy. */
export function exchangeWhenLabel(
  startAt: string,
  endAt: string,
  locale: string,
): string {
  const day = new Intl.DateTimeFormat(locale, {
    timeZone: VN_TZ,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(startAt));
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: VN_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${day}, ${time.format(new Date(startAt))}-${time.format(new Date(endAt))}`;
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

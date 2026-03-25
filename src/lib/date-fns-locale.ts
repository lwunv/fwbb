import type { Locale } from "date-fns";
import { enUS, vi, zhCN } from "date-fns/locale";

/** Khớp mã locale cookie/next-intl (`vi` | `en` | `zh`) với date-fns */
export function getDateFnsLocale(appLocale: string): Locale {
  if (appLocale === "en") return enUS;
  if (appLocale === "zh") return zhCN;
  return vi;
}

/**
 * Monogram + palette theo từng hãng (không dùng logo vector có bản quyền).
 */
export const AVATAR_BRAND_KEYS = [
  "yonex",
  "lining",
  "victor",
  "felet",
  "mizuno",
  "babolat",
  "apacs",
  "kawasaki",
  "wilson",
  "carlton",
  "senston",
] as const;

export type AvatarBrandKey = (typeof AVATAR_BRAND_KEYS)[number];

export interface BrandPreset {
  id: AvatarBrandKey;
  /** Tên hiển thị trong picker */
  label: string;
  monogram: string;
  bg: string;
  fg: string;
  border: string;
}

export const BRAND_PRESETS: Record<AvatarBrandKey, BrandPreset> = {
  yonex: { id: "yonex", label: "Yonex", monogram: "Y", bg: "#004C97", fg: "#FFFFFF", border: "#003366" },
  lining: { id: "lining", label: "Li-Ning", monogram: "LN", bg: "#E60012", fg: "#FFFFFF", border: "#B5000E" },
  victor: { id: "victor", label: "Victor", monogram: "V", bg: "#1A1A1A", fg: "#E8503A", border: "#E8503A" },
  felet: { id: "felet", label: "Felet", monogram: "F", bg: "#0F172A", fg: "#F59E0B", border: "#334155" },
  mizuno: { id: "mizuno", label: "Mizuno", monogram: "M", bg: "#003087", fg: "#FFFFFF", border: "#001F5C" },
  babolat: { id: "babolat", label: "Babolat", monogram: "B", bg: "#111827", fg: "#FBBF24", border: "#374151" },
  apacs: { id: "apacs", label: "Apacs", monogram: "A", bg: "#14532D", fg: "#BBF7D0", border: "#166534" },
  kawasaki: { id: "kawasaki", label: "Kawasaki", monogram: "K", bg: "#4D7C0F", fg: "#ECFCCB", border: "#365314" },
  wilson: { id: "wilson", label: "Wilson", monogram: "W", bg: "#B91C1C", fg: "#FFFFFF", border: "#7F1D1D" },
  carlton: { id: "carlton", label: "Carlton", monogram: "C", bg: "#0369A1", fg: "#E0F2FE", border: "#075985" },
  senston: { id: "senston", label: "Senston", monogram: "S", bg: "#374151", fg: "#F9FAFB", border: "#1F2937" },
};

export const BRAND_PRESET_LIST = AVATAR_BRAND_KEYS.map((k) => BRAND_PRESETS[k]);

export function isAvatarBrandKey(k: string): k is AvatarBrandKey {
  return (AVATAR_BRAND_KEYS as readonly string[]).includes(k);
}

export function getBrandPreset(key: string): BrandPreset | null {
  return isAvatarBrandKey(key) ? BRAND_PRESETS[key] : null;
}

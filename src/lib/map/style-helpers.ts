import type { LayerSpecification } from "maplibre-gl";

/**
 * Đọc màu theme từ CSS variable (vd `--primary`) để đưa vào paint của
 * maplibre, vì maplibre không hiểu `var(...)`. Trả `undefined` khi không đọc
 * được (SSR, test) để chỗ gọi bỏ thuộc tính đó, maplibre dùng mặc định.
 */
export function cssColor(
  el: Element | null | undefined,
  name: string,
): string | undefined {
  if (!el || typeof getComputedStyle !== "function") return undefined;
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  return value || undefined;
}

/**
 * Chọn bộ font chữ mà style nền đang dùng, ưu tiên bộ có `keyword` (vd
 * "Italic", "Bold"). Lấy từ chính style thì chắc chắn server glyph có font
 * đó; đặt tên font không có trên server là nhãn biến mất không báo lỗi.
 */
export function styleFont(
  layers: LayerSpecification[],
  keyword: string,
): string[] {
  let fallback: string[] | undefined;
  for (const layer of layers) {
    if (layer.type !== "symbol") continue;
    const font: unknown = layer.layout?.["text-font"];
    if (!Array.isArray(font) || !font.every((f) => typeof f === "string")) {
      continue;
    }
    if (font.some((f: string) => f.includes(keyword))) return font;
    fallback ??= font;
  }
  return fallback ?? [`Noto Sans ${keyword}`];
}

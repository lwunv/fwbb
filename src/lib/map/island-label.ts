import type { LatLng } from "@/lib/geo";
import { isInVietnam } from "@/lib/geo";
import { VN_ISLAND_AREAS, VN_ISLAND_LABELS } from "./sovereignty";

/**
 * Nhãn Việt Nam của điểm nằm trong vùng Hoàng Sa / Trường Sa, hoặc null.
 * Hộp thứ i của VN_ISLAND_AREAS tương ứng VN_ISLAND_LABELS[i].
 */
export function islandLabelAt(
  p: LatLng,
  locale: "vi" | "en" | "zh",
): string | null {
  for (let i = 0; i < VN_ISLAND_AREAS.coordinates.length; i++) {
    const ring = VN_ISLAND_AREAS.coordinates[i][0];
    const [west, south] = ring[0];
    const [east, north] = ring[2];
    if (p.lng >= west && p.lng <= east && p.lat >= south && p.lat <= north) {
      return VN_ISLAND_LABELS[i].name[locale];
    }
  }
  return null;
}

/** Như isInVietnam nhưng nhận cả hai quần đảo (isInVietnam giữ nguyên cho đề xuất sân). */
export function isInVietnamOrIslands(p: LatLng): boolean {
  return isInVietnam(p) || islandLabelAt(p, "vi") !== null;
}

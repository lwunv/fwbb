/**
 * Toán địa lý thuần cho danh bạ sân / giao lưu. Không phụ thuộc DB hay
 * runtime nên dùng chung được ở server action, client component và test.
 *
 * Khoảng cách là đường chim bay (haversine), không phải đường bộ: public OSRM
 * không cho dùng production, và với bán kính vài km thì sai số chấp nhận được.
 */

export type LatLng = { lat: number; lng: number };

const EARTH_RADIUS_M = 6_371_000;
/** Mét trên một độ vĩ (gần đúng, đủ cho khung lọc sơ bộ). */
const METERS_PER_DEG_LAT = 111_320;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Khoảng cách đường chim bay giữa hai điểm, đơn vị mét. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Khung vuông bao trọn hình tròn bán kính `radiusMeters`. Dùng để lọc sơ bộ
 * bằng index `(lat, lng)` trong SQLite (không có PostGIS); caller phải lọc lại
 * bằng `haversineMeters` vì góc khung nằm ngoài bán kính.
 */
export function boundingBox(
  center: LatLng,
  radiusMeters: number,
): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  const dLat = radiusMeters / METERS_PER_DEG_LAT;
  const dLng =
    radiusMeters / (METERS_PER_DEG_LAT * Math.cos(toRad(center.lat)));
  return {
    minLat: center.lat - dLat,
    maxLat: center.lat + dLat,
    minLng: center.lng - dLng,
    maxLng: center.lng + dLng,
  };
}

/** "850 m" dưới 1 km; từ 1 km trở lên 1 chữ số thập phân theo locale. */
export function formatDistance(
  meters: number,
  locale: "vi" | "en" | "zh",
): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = (meters / 1000).toFixed(1);
  return `${locale === "vi" ? km.replace(".", ",") : km} km`;
}

/**
 * Làm tròn toạ độ về ô lưới — khoá cache cho truy vấn "quanh đây" để nhiều
 * người đứng gần nhau dùng chung một lần đọc DB. `toFixed(6)` để không ra
 * 21.030000000000001 làm lệch khoá cache.
 */
export function snapToGrid(p: LatLng, step = 0.01): LatLng {
  const snap = (x: number) => Number((Math.round(x / step) * step).toFixed(6));
  return { lat: snap(p.lat), lng: snap(p.lng) };
}

/** Khung Việt Nam rộng (gồm cả biển đảo gần bờ). Chặn toạ độ bị đảo lat/lng. */
export const VN_BOUNDS = {
  minLat: 8,
  maxLat: 24,
  minLng: 102,
  maxLng: 110,
} as const;

export function isInVietnam(p: LatLng): boolean {
  return (
    p.lat >= VN_BOUNDS.minLat &&
    p.lat <= VN_BOUNDS.maxLat &&
    p.lng >= VN_BOUNDS.minLng &&
    p.lng <= VN_BOUNDS.maxLng
  );
}

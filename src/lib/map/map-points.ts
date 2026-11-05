import { haversineMeters, type LatLng } from "@/lib/geo";
import type { PublicVenue } from "@/lib/public-venue";
import type { ExchangeCard } from "@/lib/exchange/public-event";
import type { Feature, Polygon } from "geojson";

/** Style nền OpenFreeMap (không cần API key). */
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

/**
 * Điểm ghim trên bản đồ. Ghim giao lưu đứng theo SÂN (`id` là venueId), `count`
 * là số buổi tại sân đó. Id của hai loại có thể trùng nhau, nên khoá định danh
 * luôn là `pointKey`, không phải `id`.
 */
export type MapPoint =
  | { kind: "venue"; id: number; lat: number; lng: number; label: string }
  | {
      kind: "exchange";
      id: number;
      lat: number;
      lng: number;
      label: string;
      count: number;
    };

export function pointKey(p: MapPoint): string {
  return `${p.kind}:${p.id}`;
}

/** Gom các buổi theo sân: một ghim mỗi sân, kèm số buổi. */
export function exchangesToPoints(
  events: Pick<ExchangeCard, "venue">[],
): MapPoint[] {
  const byVenue = new Map<number, MapPoint & { kind: "exchange" }>();
  for (const e of events) {
    const hit = byVenue.get(e.venue.id);
    if (hit) hit.count += 1;
    else
      byVenue.set(e.venue.id, {
        kind: "exchange",
        id: e.venue.id,
        lat: e.venue.lat,
        lng: e.venue.lng,
        label: e.venue.name,
        count: 1,
      });
  }
  return [...byVenue.values()];
}

export function venuesToPoints(
  venues: Pick<PublicVenue, "id" | "lat" | "lng" | "name">[],
): MapPoint[] {
  return venues.map((v) => ({
    kind: "venue",
    id: v.id,
    lat: v.lat,
    lng: v.lng,
    label: v.name,
  }));
}

/** Zoom vừa khít vòng bán kính trên màn hình điện thoại. */
export function zoomForRadiusKm(km: number): number {
  if (km <= 3) return 13;
  if (km <= 5) return 12;
  if (km <= 10) return 11;
  return 10;
}

const EARTH_RADIUS_M = 6_371_000;

/**
 * Vòng tròn bán kính `km` quanh `center` dạng GeoJSON Polygon khép kín
 * (`steps + 1` điểm). Dùng cùng bán kính Trái Đất với `haversineMeters` để
 * vòng vẽ ra khớp đúng bộ lọc khoảng cách phía server.
 */
export function radiusCircle(
  center: LatLng,
  km: number,
  steps = 64,
): Feature<Polygon> {
  const lat1 = (center.lat * Math.PI) / 180;
  const lng1 = (center.lng * Math.PI) / 180;
  const ang = (km * 1000) / EARTH_RADIUS_M;
  const ring: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const bearing = (2 * Math.PI * i) / steps;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(ang) +
        Math.cos(lat1) * Math.sin(ang) * Math.cos(bearing),
    );
    const lng2 =
      lng1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(ang) * Math.cos(lat1),
        Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2),
      );
    ring.push([(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  ring.push([...ring[0]]);
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [ring] },
  };
}

/** True khi hai điểm cách nhau hơn `km` (đường chim bay). */
export function movedBeyond(a: LatLng, b: LatLng, km: number): boolean {
  return haversineMeters(a, b) > km * 1000;
}

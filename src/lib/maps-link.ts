import type { LatLng } from "./geo";

/**
 * Tách toạ độ từ link Google Maps người dùng dán vào. Hàm thuần, không gọi
 * mạng (link rút gọn xem `maps-link-resolve.ts`).
 *
 * Chỉ nhận host của Google: link host khác có thể mang `?q=` hợp lệ nhưng
 * không có lý do gì để tin.
 */

export const SHORT_LINK_HOSTS = ["maps.app.goo.gl", "goo.gl"] as const;

export const MAPS_HOSTS = [
  "google.com",
  "www.google.com",
  "maps.google.com",
  "google.com.vn",
  "www.google.com.vn",
  "maps.google.com.vn",
] as const;

const NUM = String.raw`(-?\d{1,3}(?:\.\d+)?)`;
// `!3d..!4d..` là toạ độ của ĐỊA ĐIỂM; `@lat,lng` chỉ là tâm khung nhìn lúc
// người dùng bấm chia sẻ, có thể lệch vài trăm mét. Thử `!3d` trước.
const PLACE_RE = new RegExp(String.raw`!3d${NUM}!4d${NUM}`);
const VIEWPORT_RE = new RegExp(String.raw`@${NUM},${NUM}`);
const PAIR_RE = new RegExp(String.raw`^\s*${NUM}\s*,\s*${NUM}\s*$`);
const PAIR_PARAMS = ["q", "query", "ll", "destination"] as const;

function toLatLng(latRaw: string, lngRaw: string): LatLng | null {
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export function isMapsHost(host: string): boolean {
  return (MAPS_HOSTS as readonly string[]).includes(host.toLowerCase());
}

export function isShortLinkHost(host: string): boolean {
  return (SHORT_LINK_HOSTS as readonly string[]).includes(host.toLowerCase());
}

export function parseLatLngFromMapsUrl(url: string): LatLng | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!isMapsHost(u.hostname)) return null;

  const full = decodeURIComponent(u.pathname + u.search + u.hash);
  const place = PLACE_RE.exec(full);
  if (place) return toLatLng(place[1], place[2]);

  const viewport = VIEWPORT_RE.exec(u.pathname);
  if (viewport) return toLatLng(viewport[1], viewport[2]);

  for (const key of PAIR_PARAMS) {
    const v = u.searchParams.get(key);
    const m = v ? PAIR_RE.exec(v) : null;
    if (m) return toLatLng(m[1], m[2]);
  }
  return null;
}

/** Link mở Google Maps chỉ đường tới điểm (free, không cần API key). */
export function directionsUrl(p: LatLng): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
}

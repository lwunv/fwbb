import type { LatLng } from "@/lib/geo";
import { isInVietnamOrIslands } from "@/lib/map/island-label";
import { openStatus } from "./open-hours";

export const VENUE_RADII = [3, 5, 10, 20] as const;
export type VenueRadius = (typeof VENUE_RADII)[number];

/** Hà Nội. */
export const DEFAULT_CENTER: LatLng = { lat: 21.0285, lng: 105.8542 };

/** Kéo bản đồ quá 30% bán kính thì mới đáng mời tìm lại ở khu vực mới. */
export const SEARCH_HERE_RATIO = 0.3;

export const LAST_AREA_KEY = "fwbb.venues.lastArea";

/** Chỉ nhận toạ độ hữu hạn nằm trong Việt Nam (kể cả hai quần đảo). */
export function parseUrlCenter(
  lat: number | null,
  lng: number | null,
): LatLng | null {
  if (lat === null || lng === null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const p = { lat, lng };
  return isInVietnamOrIslands(p) ? p : null;
}

export function roundCoord(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

export type StoredArea = { lat: number; lng: number; label: string };

export function readStoredArea(): StoredArea | null {
  try {
    const raw = localStorage.getItem(LAST_AREA_KEY);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return null;
    const { lat, lng, label } = v as Record<string, unknown>;
    if (
      typeof lat !== "number" ||
      typeof lng !== "number" ||
      typeof label !== "string"
    ) {
      return null;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (!isInVietnamOrIslands({ lat, lng })) return null;
    return { lat, lng, label };
  } catch {
    // Vùng đã lưu chỉ là tiện ích: storage bị chặn thì coi như chưa lưu.
    return null;
  }
}

export function writeStoredArea(a: StoredArea): void {
  try {
    localStorage.setItem(LAST_AREA_KEY, JSON.stringify(a));
  } catch {
    // Tiện ích, không phải nghiệp vụ: storage đầy hoặc bị chặn thì bỏ qua.
  }
}

export type CenterSource = "url" | "gps" | "stored" | "default";

export function resolveCenter(i: {
  url: LatLng | null;
  gps: LatLng | null;
  stored: StoredArea | null;
}): { center: LatLng; source: CenterSource; label: string | null } {
  if (i.url) return { center: i.url, source: "url", label: null };
  if (i.gps) return { center: i.gps, source: "gps", label: null };
  if (i.stored) {
    return {
      center: { lat: i.stored.lat, lng: i.stored.lng },
      source: "stored",
      label: i.stored.label,
    };
  }
  return { center: DEFAULT_CENTER, source: "default", label: null };
}

/** `exchangeOnly` mà `counts` chưa có (đang đếm) thì không lọc. */
export function filterVenues<
  T extends { id: number; openHours: string | null },
>(
  venues: T[],
  o: {
    exchangeOnly: boolean;
    counts: Map<number, number> | undefined;
    openNow: boolean;
    now: Date;
  },
): T[] {
  return venues.filter((v) => {
    if (o.exchangeOnly && o.counts && (o.counts.get(v.id) ?? 0) <= 0) {
      return false;
    }
    if (o.openNow && openStatus(v.openHours, o.now) !== "open") return false;
    return true;
  });
}

export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function matchVenuesByName<
  T extends { name: string; distanceM?: number },
>(venues: T[], q: string, limit = 5): T[] {
  const nq = normalizeName(q);
  if (nq.length < 2) return [];
  return venues
    .map((v) => ({ v, n: normalizeName(v.name) }))
    .filter((x) => x.n.includes(nq))
    .sort((a, b) => {
      const pa = a.n.startsWith(nq) ? 0 : 1;
      const pb = b.n.startsWith(nq) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return (
        (a.v.distanceM ?? Number.POSITIVE_INFINITY) -
        (b.v.distanceM ?? Number.POSITIVE_INFINITY)
      );
    })
    .slice(0, limit)
    .map((x) => x.v);
}

/** Tên chuẩn hoá BẰNG câu tìm: "Cầu Giấy" bay tới quận, không chọn "Sân cầu lông Cầu Giấy". */
export function exactVenueMatch<T extends { name: string }>(
  venues: T[],
  q: string,
): T | null {
  const nq = normalizeName(q);
  if (!nq) return null;
  return venues.find((v) => normalizeName(v.name) === nq) ?? null;
}

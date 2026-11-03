import type { venues } from "@/db/schema";
import { VENUE_AMENITIES, type VenueAmenity } from "./venue-amenities";

/**
 * Dạng sân trả ra trang công khai. Whitelist từng cột, KHÔNG spread row:
 * `submittedByMemberId` / `status` không được lộ (xem feedback redact public
 * payload).
 */
export type PublicVenue = {
  id: number;
  name: string;
  address: string | null;
  areaLabel: string | null;
  lat: number;
  lng: number;
  mapLink: string | null;
  courtCount: number | null;
  openHours: string | null;
  amenities: VenueAmenity[];
  phone: string | null;
  refPricePerHour: number | null;
  photoLink: string | null;
};

export const PUBLIC_VENUE_KEYS: readonly (keyof PublicVenue)[] = [
  "id",
  "name",
  "address",
  "areaLabel",
  "lat",
  "lng",
  "mapLink",
  "courtCount",
  "openHours",
  "amenities",
  "phone",
  "refPricePerHour",
  "photoLink",
];

/**
 * Đọc `amenities` (JSON) an toàn: hỏng hoặc có mã lạ thì bỏ qua, không làm vỡ
 * cả danh sách sân chỉ vì một dòng dữ liệu xấu.
 */
export function parseAmenities(raw: string | null | undefined): VenueAmenity[] {
  if (!raw) return [];
  try {
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((a): a is VenueAmenity =>
      (VENUE_AMENITIES as readonly unknown[]).includes(a),
    );
  } catch {
    return [];
  }
}

export function toPublicVenue(row: typeof venues.$inferSelect): PublicVenue {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    areaLabel: row.areaLabel,
    lat: row.lat,
    lng: row.lng,
    mapLink: row.mapLink,
    courtCount: row.courtCount,
    openHours: row.openHours,
    amenities: parseAmenities(row.amenities),
    phone: row.phone,
    refPricePerHour: row.refPricePerHour,
    photoLink: row.photoLink,
  };
}

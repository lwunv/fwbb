/**
 * Mã tiện ích cố định của sân. Lưu trong `venues.amenities` dạng JSON mảng mã
 * (không lưu chữ hiển thị) để đổi bản dịch không phải migrate dữ liệu.
 */
export const VENUE_AMENITIES = [
  "parking",
  "air_con",
  "shuttle_shop",
  "racket_rental",
  "drinks",
  "shower",
] as const;

export type VenueAmenity = (typeof VENUE_AMENITIES)[number];

export const VENUE_STATUSES = ["pending", "approved", "hidden"] as const;

export type VenueStatus = (typeof VENUE_STATUSES)[number];

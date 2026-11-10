import {
  CupSoda,
  HandCoins,
  ShoppingBag,
  ShowerHead,
  Snowflake,
  SquareParking,
  type LucideIcon,
} from "lucide-react";
import type { VenueAmenity } from "@/lib/venue-amenities";

/** Icon cho từng tiện ích, dùng chung thẻ sân và bộ lọc. */
export const AMENITY_ICONS: Record<VenueAmenity, LucideIcon> = {
  parking: SquareParking,
  air_con: Snowflake,
  shuttle_shop: ShoppingBag,
  racket_rental: HandCoins,
  drinks: CupSoda,
  shower: ShowerHead,
};

"use client";

import {
  parseAsArrayOf,
  parseAsBoolean,
  parseAsFloat,
  parseAsInteger,
  parseAsNumberLiteral,
  parseAsStringLiteral,
  useQueryStates,
} from "nuqs";
import { VENUE_AMENITIES } from "@/lib/venue-amenities";
import { VENUE_RADII } from "@/lib/venues/directory-state";

export const venueUrlParsers = {
  r: parseAsNumberLiteral(VENUE_RADII).withDefault(5),
  amenities: parseAsArrayOf(parseAsStringLiteral(VENUE_AMENITIES)).withDefault(
    [],
  ),
  exchange: parseAsBoolean.withDefault(false),
  open: parseAsBoolean.withDefault(false),
  lat: parseAsFloat,
  lng: parseAsFloat,
  venue: parseAsInteger,
};

export function useVenueUrlState() {
  return useQueryStates(venueUrlParsers, { history: "replace", shallow: true });
}

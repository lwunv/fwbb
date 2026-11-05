"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Clock, MapPin, Navigation, Phone } from "lucide-react";
import { directionsUrl } from "@/lib/maps-link";
import { formatDistance } from "@/lib/geo";
import { formatK } from "@/lib/utils";
import type { PublicVenue } from "@/lib/public-venue";
import { Card, CardContent } from "@/components/ui/card";

/** Thẻ sân trong danh bạ (học theo cách ALOBO trình bày danh sách sân). */
export function VenueCard({
  venue,
  locale,
  upcomingExchangeCount,
}: {
  venue: PublicVenue & { distanceM?: number };
  locale: "vi" | "en" | "zh";
  /** Chỉ truyền khi cờ giao lưu bật; undefined hoặc 0 thì không hiện gì thêm. */
  upcomingExchangeCount?: number;
}) {
  const t = useTranslations("venues");
  return (
    <Card className="bg-card/80 border-border/60 backdrop-blur">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <div className="bg-primary/10 text-primary flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
            <MapPin className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1 space-y-0.5">
            <Link
              href={`/san/${venue.id}`}
              className="block truncate text-base font-semibold hover:underline"
            >
              {venue.name}
            </Link>
            {(venue.address || venue.areaLabel) && (
              <p className="text-muted-foreground line-clamp-2 text-sm">
                {venue.address || venue.areaLabel}
              </p>
            )}
          </div>
          {venue.distanceM !== undefined && (
            <span className="bg-accent shrink-0 rounded-full px-2.5 py-1 text-sm font-medium tabular-nums">
              {formatDistance(venue.distanceM, locale)}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {venue.courtCount != null && (
            <span>{t("courtCountValue", { count: venue.courtCount })}</span>
          )}
          {venue.refPricePerHour != null && (
            <span className="text-primary font-medium tabular-nums">
              {t("pricePerHourValue", {
                price: `${formatK(venue.refPricePerHour)}đ`,
              })}
            </span>
          )}
          {venue.openHours && (
            <span className="text-muted-foreground inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {venue.openHours}
            </span>
          )}
        </div>

        {upcomingExchangeCount !== undefined && upcomingExchangeCount > 0 && (
          <Link
            href={`/san/${venue.id}`}
            className="bg-primary/15 text-primary inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium"
          >
            {t("upcomingExchangeCount", { count: upcomingExchangeCount })}
          </Link>
        )}

        {venue.amenities.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {venue.amenities.map((a) => (
              <li
                key={a}
                className="bg-accent/70 rounded-full px-2.5 py-0.5 text-sm"
              >
                {t(`amenity.${a}`)}
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-2">
          <a
            href={directionsUrl(venue)}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-primary text-primary-foreground inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium active:scale-[0.98]"
          >
            <Navigation className="h-4 w-4" />
            {t("directions")}
          </a>
          {venue.phone && (
            <a
              href={`tel:${venue.phone.replace(/[^0-9+]/g, "")}`}
              className="bg-card inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium"
            >
              <Phone className="h-4 w-4" />
              {venue.phone}
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

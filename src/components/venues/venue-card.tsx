"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Navigation } from "lucide-react";
import { directionsUrl } from "@/lib/maps-link";
import { formatDistance } from "@/lib/geo";
import { formatK } from "@/lib/utils";
import { openStatus } from "@/lib/venues/open-hours";
import type { PublicVenue } from "@/lib/public-venue";
import { Card, CardContent } from "@/components/ui/card";
import { AMENITY_ICONS } from "./amenity-icons";

/**
 * Thẻ sân gọn: tên, số sân, giá, trạng thái mở cửa, icon tiện ích.
 * Có `onSelect` thì cả thẻ là một nút chọn (dùng trong ngăn kéo bản đồ);
 * link Chỉ đường là phần tử anh em nổi lên trên nút, không lồng trong nó.
 */
export function VenueCard({
  venue,
  locale,
  upcomingExchangeCount,
  now,
  onSelect,
  selected,
}: {
  venue: PublicVenue & { distanceM?: number };
  locale: "vi" | "en" | "zh";
  /** Chỉ truyền khi cờ giao lưu bật; undefined hoặc 0 thì không hiện gì thêm. */
  upcomingExchangeCount?: number;
  /** Mặc định `new Date()`; truyền vào để test và để mọi thẻ cùng một mốc giờ. */
  now?: Date;
  onSelect?: () => void;
  selected?: boolean;
}) {
  const t = useTranslations("venues");

  const status = venue.openHours
    ? openStatus(venue.openHours, now ?? new Date())
    : null;
  const hoursPart =
    status === null
      ? null
      : status === "unknown"
        ? t("hoursUnknown")
        : t("openStatusWithHours", {
            status: t(status === "open" ? "openNow" : "closedNow"),
            hours: venue.openHours as string,
          });

  const infoParts = [
    venue.courtCount != null
      ? t("courtCountValue", { count: venue.courtCount })
      : null,
    venue.refPricePerHour != null
      ? t("pricePerHourValue", { price: `${formatK(venue.refPricePerHour)}đ` })
      : null,
    hoursPart,
  ].filter((p): p is string => p !== null);

  return (
    <Card
      className={`bg-card/80 border-border/60 backdrop-blur ${selected ? "ring-primary ring-2" : ""}`}
    >
      <CardContent className="p-0">
        <div className="relative flex items-start gap-2 p-3 pr-2">
          {onSelect && (
            <button
              type="button"
              onClick={onSelect}
              aria-label={venue.name}
              aria-pressed={selected}
              className="active:bg-accent/40 absolute inset-0 rounded-xl"
            />
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2">
              {onSelect ? (
                <span className="block min-w-0 flex-1 truncate text-base font-semibold">
                  {venue.name}
                </span>
              ) : (
                <Link
                  href={`/venues/${venue.id}`}
                  className="block min-w-0 flex-1 truncate text-base font-semibold hover:underline"
                >
                  {venue.name}
                </Link>
              )}
              {venue.distanceM !== undefined && (
                <span className="bg-accent shrink-0 rounded-full px-2.5 py-0.5 text-sm font-medium tabular-nums">
                  {formatDistance(venue.distanceM, locale)}
                </span>
              )}
            </div>
            {infoParts.length > 0 && (
              <p className="text-muted-foreground text-base">
                {infoParts.map((part, i) => (
                  <span key={i}>
                    {i > 0 && <span aria-hidden> · </span>}
                    <span>{part}</span>
                  </span>
                ))}
              </p>
            )}
            {venue.amenities.length > 0 && (
              <ul className="text-muted-foreground flex flex-wrap gap-3">
                {venue.amenities.map((a) => {
                  const Icon = AMENITY_ICONS[a];
                  return (
                    <li key={a} title={t(`amenity.${a}`)}>
                      <Icon className="size-5" aria-hidden />
                      <span className="sr-only">{t(`amenity.${a}`)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {upcomingExchangeCount !== undefined &&
              upcomingExchangeCount > 0 && (
                <p className="bg-warning/15 text-foreground rounded-lg px-3 py-1.5 text-sm font-medium">
                  {t("upcomingExchangeCount", { count: upcomingExchangeCount })}
                </p>
              )}
          </div>
          <a
            href={directionsUrl(venue)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("directionsTo", { name: venue.name })}
            title={t("directions")}
            className="bg-primary text-primary-foreground relative z-10 inline-flex size-11 shrink-0 items-center justify-center rounded-full active:scale-95"
          >
            <Navigation className="size-5" aria-hidden />
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

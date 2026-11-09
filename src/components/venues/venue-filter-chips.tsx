"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarHeart, ChevronDown, Clock3 } from "lucide-react";
import { ResponsiveSheet } from "@/components/exchange/responsive-sheet";
import { VENUE_AMENITIES, type VenueAmenity } from "@/lib/venue-amenities";
import { VENUE_RADII, type VenueRadius } from "@/lib/venues/directory-state";
import { cn } from "@/lib/utils";
import { AMENITY_ICONS } from "./amenity-icons";

const CHIP =
  "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-medium whitespace-nowrap shadow-sm backdrop-blur transition-colors active:scale-[0.98]";
const CHIP_OFF = "bg-card/90 text-foreground";
const CHIP_ON = "bg-primary text-primary-foreground border-transparent";

/** Hàng chip lọc nổi trên bản đồ: giao lưu, bán kính, tiện ích, đang mở cửa. */
export function VenueFilterChips({
  radius,
  onRadius,
  amenities,
  onAmenities,
  exchange,
  onExchange,
  showExchange,
  openNow,
  onOpenNow,
}: {
  radius: VenueRadius;
  onRadius: (r: VenueRadius) => void;
  amenities: VenueAmenity[];
  onAmenities: (a: VenueAmenity[]) => void;
  exchange: boolean;
  onExchange: (v: boolean) => void;
  showExchange: boolean;
  openNow: boolean;
  onOpenNow: (v: boolean) => void;
}) {
  const t = useTranslations("venues");
  const [radiusOpen, setRadiusOpen] = useState(false);
  const [amenitiesOpen, setAmenitiesOpen] = useState(false);

  const toggleAmenity = (a: VenueAmenity) => {
    const next = new Set(amenities);
    if (next.has(a)) next.delete(a);
    else next.add(a);
    // Giữ thứ tự cố định để URL và so sánh không phụ thuộc thứ tự bấm.
    onAmenities(VENUE_AMENITIES.filter((x) => next.has(x)));
  };

  return (
    <>
      <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {showExchange && (
          <button
            type="button"
            aria-pressed={exchange}
            onClick={() => onExchange(!exchange)}
            className={cn(CHIP, exchange ? CHIP_ON : CHIP_OFF)}
          >
            <CalendarHeart className="size-4" aria-hidden />
            {t("chipExchange")}
          </button>
        )}
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setRadiusOpen(true)}
          className={cn(CHIP, CHIP_OFF)}
        >
          {t("chipRadius", { km: radius })}
          <ChevronDown className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-pressed={amenities.length > 0}
          aria-haspopup="dialog"
          onClick={() => setAmenitiesOpen(true)}
          className={cn(CHIP, amenities.length > 0 ? CHIP_ON : CHIP_OFF)}
        >
          {amenities.length > 0
            ? t("chipAmenitiesCount", { count: amenities.length })
            : t("chipAmenities")}
          <ChevronDown className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-pressed={openNow}
          onClick={() => onOpenNow(!openNow)}
          className={cn(CHIP, openNow ? CHIP_ON : CHIP_OFF)}
        >
          <Clock3 className="size-4" aria-hidden />
          {t("chipOpenNow")}
        </button>
      </div>

      <ResponsiveSheet
        open={radiusOpen}
        onOpenChange={setRadiusOpen}
        title={t("radius")}
      >
        <div role="radiogroup" aria-label={t("radius")} className="grid gap-2">
          {VENUE_RADII.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={r === radius}
              onClick={() => {
                onRadius(r);
                setRadiusOpen(false);
              }}
              className={cn(
                "flex min-h-11 items-center justify-between rounded-xl border px-4 text-base font-medium",
                r === radius ? CHIP_ON : "bg-card text-foreground",
              )}
            >
              {t("radiusValue", { km: r })}
            </button>
          ))}
        </div>
      </ResponsiveSheet>

      <ResponsiveSheet
        open={amenitiesOpen}
        onOpenChange={setAmenitiesOpen}
        title={t("filterAmenities")}
        footer={
          <button
            type="button"
            onClick={() => setAmenitiesOpen(false)}
            className="bg-primary text-primary-foreground min-h-11 w-full rounded-xl text-base font-semibold"
          >
            {t("done")}
          </button>
        }
      >
        <div className="grid grid-cols-2 gap-2">
          {VENUE_AMENITIES.map((a) => {
            const Icon = AMENITY_ICONS[a];
            const on = amenities.includes(a);
            return (
              <button
                key={a}
                type="button"
                aria-pressed={on}
                onClick={() => toggleAmenity(a)}
                className={cn(
                  "flex min-h-11 items-center gap-2 rounded-xl border px-3 text-base font-medium",
                  on ? CHIP_ON : "bg-card text-foreground",
                )}
              >
                <Icon className="size-5 shrink-0" aria-hidden />
                {t(`amenity.${a}`)}
              </button>
            );
          })}
        </div>
      </ResponsiveSheet>
    </>
  );
}

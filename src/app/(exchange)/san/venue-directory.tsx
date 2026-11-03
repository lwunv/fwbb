"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import {
  parseAsArrayOf,
  parseAsNumberLiteral,
  parseAsStringLiteral,
  useQueryState,
} from "nuqs";
import { AnimatePresence, motion } from "framer-motion";
import { LocateFixed, MapPinned, Plus } from "lucide-react";
import { listVenuesNear } from "@/actions/venues";
import { VENUE_AMENITIES } from "@/lib/venue-amenities";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { VenueCard } from "@/components/venues/venue-card";
import { LocationFallback } from "@/components/venues/location-fallback";
import { useUserLocation } from "@/components/venues/use-user-location";

const RADII = [3, 5, 10, 20] as const;

export function VenueDirectory({ canSuggest }: { canSuggest: boolean }) {
  const t = useTranslations("venues");
  const locale = useLocale() as "vi" | "en" | "zh";
  const [radius, setRadius] = useQueryState(
    "r",
    parseAsNumberLiteral(RADII).withDefault(5),
  );
  const [amenities, setAmenities] = useQueryState(
    "a",
    parseAsArrayOf(parseAsStringLiteral(VENUE_AMENITIES)).withDefault([]),
  );
  const loc = useUserLocation();
  const { request } = loc;

  // Hỏi vị trí đúng một lần khi mở trang.
  useEffect(() => {
    request();
  }, [request]);

  const pos = loc.position;
  const query = useQuery({
    queryKey: [
      "venues-near",
      pos?.lat.toFixed(3),
      pos?.lng.toFixed(3),
      radius,
      [...amenities].sort().join(","),
    ],
    queryFn: async () => {
      const r = await listVenuesNear({
        lat: pos!.lat,
        lng: pos!.lng,
        radiusKm: radius,
        amenities,
      });
      if ("error" in r) throw new Error(r.error);
      return r.venues;
    },
    enabled: loc.status === "ok" && pos !== null,
    staleTime: 60_000,
  });

  const nextRadius = RADII.find((r) => r > radius);

  return (
    <div className="space-y-4 pb-24">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{t("pageTitle")}</h1>
        <p className="text-muted-foreground text-base">{t("pageSubtitle")}</p>
      </header>

      <section className="space-y-3" aria-label={t("radius")}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{t("radius")}</span>
          {RADII.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={radius === r}
              onClick={() => setRadius(r)}
              className={cn(
                "min-h-11 rounded-full border px-4 text-sm font-medium transition-colors",
                radius === r
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card/80 hover:bg-accent",
              )}
            >
              {t("radiusValue", { km: r })}
            </button>
          ))}
        </div>
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label={t("filterAmenities")}
        >
          {VENUE_AMENITIES.map((a) => {
            const on = amenities.includes(a);
            return (
              <button
                key={a}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setAmenities(
                    on ? amenities.filter((x) => x !== a) : [...amenities, a],
                  )
                }
                className={cn(
                  "min-h-11 rounded-full border px-3.5 text-sm transition-colors",
                  on
                    ? "bg-primary/15 border-primary text-primary"
                    : "bg-card/80 hover:bg-accent",
                )}
              >
                {t(`amenity.${a}`)}
              </button>
            );
          })}
        </div>
      </section>

      {loc.status === "ok" && loc.label && (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground truncate">
            {t("searchingNear", { label: loc.label })}
          </span>
          <button
            type="button"
            onClick={request}
            className="text-primary inline-flex min-h-11 shrink-0 items-center gap-1"
          >
            <LocateFixed className="h-4 w-4" />
            {t("useMyLocation")}
          </button>
        </div>
      )}

      {(loc.status === "denied" || loc.status === "unsupported") && (
        <LocationFallback onLocated={loc.setManual} onRetryGps={request} />
      )}

      {loc.status === "asking" && (
        <p className="text-muted-foreground text-sm" role="status">
          {t("locating")}
        </p>
      )}

      {(loc.status === "asking" ||
        loc.status === "idle" ||
        (loc.status === "ok" && query.isPending)) && <ListSkeleton />}

      {query.isError && (
        <EmptyState
          icon={MapPinned}
          title={t("loadError")}
          action={
            <Button className="min-h-11" onClick={() => query.refetch()}>
              {t("retry")}
            </Button>
          }
        />
      )}

      {query.isSuccess && query.data.length === 0 && (
        <EmptyState
          icon={MapPinned}
          title={t("emptyTitle", { km: radius })}
          description={t("emptyDescription")}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {nextRadius && (
                <Button
                  className="min-h-11"
                  onClick={() => setRadius(nextRadius)}
                >
                  {t("expandRadius")}
                </Button>
              )}
              {canSuggest && (
                <Link
                  href="/san/de-xuat"
                  className="bg-card inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-medium"
                >
                  {t("suggestVenue")}
                </Link>
              )}
            </div>
          }
        />
      )}

      {query.isSuccess && query.data.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          <AnimatePresence initial={false}>
            {query.data.map((v) => (
              <motion.li
                key={v.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <VenueCard venue={v} locale={locale} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      {canSuggest && (
        <div className="bg-background/95 fixed inset-x-0 bottom-0 z-30 border-t p-3 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0">
          <Link
            href="/san/de-xuat"
            className="bg-primary text-primary-foreground flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-medium sm:w-auto sm:px-6"
          >
            <Plus className="h-5 w-5" />
            {t("suggestVenue")}
          </Link>
        </div>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <ul className="grid gap-3 sm:grid-cols-2" aria-hidden>
      {Array.from({ length: 3 }).map((_, i) => (
        <li key={i} className="bg-card space-y-3 rounded-xl border p-4">
          <div className="flex items-start gap-3">
            <Skeleton className="h-11 w-11 shrink-0 rounded-xl" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-5 w-3/5" />
              <Skeleton className="h-4 w-4/5" />
            </div>
            <Skeleton className="h-7 w-16 rounded-full" />
          </div>
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-11 w-full rounded-lg" />
        </li>
      ))}
    </ul>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ChevronLeft, Navigation } from "lucide-react";
import { getPublicVenue } from "@/actions/venues";
import { listUpcomingAtVenue } from "@/actions/exchange-read";
import { isExchangeEnabled } from "@/lib/exchange-flag";
import { ExchangeCard } from "@/components/exchange/exchange-card";
import { directionsUrl } from "@/lib/maps-link";
import { VenueCard } from "@/components/venues/venue-card";
import { VenueMiniMap } from "@/components/venues/venue-mini-map";

export default async function VenueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const venue = await getPublicVenue(Number(id));
  if (!venue) notFound();
  const [t, locale, exchangeEnabled] = await Promise.all([
    getTranslations("venues"),
    getLocale(),
    isExchangeEnabled(),
  ]);
  const exchanges = exchangeEnabled
    ? await listUpcomingAtVenue(venue.id)
    : null;

  return (
    <div className="space-y-4 pb-24">
      <Link
        href="/venues"
        className="text-muted-foreground inline-flex min-h-11 items-center gap-1 text-sm"
      >
        <ChevronLeft className="h-4 w-4" />
        {t("backToList")}
      </Link>
      <VenueCard venue={venue} locale={locale as "vi" | "en" | "zh"} />
      <VenueMiniMap venue={venue} />
      {exchanges && (
        <section className="space-y-3" aria-label={t("upcomingExchangesTitle")}>
          <h2 className="text-lg font-semibold">
            {t("upcomingExchangesTitle")}
          </h2>
          {exchanges.length === 0 ? (
            <p className="text-muted-foreground text-base">
              {t("upcomingExchangesEmpty")}
            </p>
          ) : (
            exchanges.map((e) => <ExchangeCard key={e.code} event={e} />)
          )}
        </section>
      )}
      {venue.photoLink && (
        <a
          href={venue.photoLink}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-primary inline-flex min-h-11 items-center text-sm underline underline-offset-2"
        >
          {t("photoLink")}
        </a>
      )}
      {/* Nút chỉ đường dính đáy trên mobile, trong tầm ngón cái. */}
      <div className="bg-background/95 fixed inset-x-0 bottom-0 z-30 border-t p-3 backdrop-blur sm:hidden">
        <a
          href={directionsUrl(venue)}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-primary text-primary-foreground flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-medium"
        >
          <Navigation className="h-5 w-5" />
          {t("directions")}
        </a>
      </div>
    </div>
  );
}

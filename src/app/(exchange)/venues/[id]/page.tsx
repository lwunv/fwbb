import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  CalendarX,
  ChevronLeft,
  ExternalLink,
  MapPin,
  MessageSquareText,
  Navigation,
  Phone,
} from "lucide-react";
import { getPublicVenue } from "@/actions/venues";
import { listUpcomingAtVenue } from "@/actions/exchange-read";
import { isExchangeEnabled } from "@/lib/exchange-flag";
import { directionsUrl } from "@/lib/maps-link";
import { formatK } from "@/lib/utils";
import { openStatus } from "@/lib/venues/open-hours";
import { toTelNumber } from "@/lib/venues/phone";
import { ExchangeCard } from "@/components/exchange/exchange-card";
import { InfoRow } from "@/components/shared/info-row";
import { AMENITY_ICONS } from "@/components/venues/amenity-icons";
import { VenueMiniMap } from "@/components/venues/venue-mini-map";
import { VenueOpenStatus } from "@/components/venues/venue-open-status";
import { VenueShareButton } from "@/components/venues/venue-share-button";

const ACTION =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-base font-medium active:scale-95";
const INFO_ROW = "py-3";

/**
 * Trang chi tiết sân. Dữ liệu vẫn chỉ gồm sân, cờ giao lưu và các buổi sắp tới
 * như trước, không thêm truy vấn. Trạng thái mở cửa tính theo giờ Việt Nam lúc
 * render ở server (layout đọc cookie nên trang render theo từng request), rồi
 * `VenueOpenStatus` tự tính lại ở máy khi tab mở lại sau nhiều giờ.
 */
export default async function VenueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const venue = await getPublicVenue(Number(id));
  if (!venue) notFound();
  const [t, exchangeEnabled] = await Promise.all([
    getTranslations("venues"),
    isExchangeEnabled(),
  ]);
  const exchanges = exchangeEnabled
    ? await listUpcomingAtVenue(venue.id)
    : null;

  const address = venue.address?.trim() || null;
  const hours = venue.openHours?.trim() || null;
  const status = hours ? openStatus(hours, new Date()) : null;
  const phoneText = venue.phone?.trim() ?? "";
  // Không có chữ số nào ("+", "không có") thì không có gì để gọi.
  const tel = toTelNumber(phoneText);
  const hasInfo =
    address !== null ||
    status !== null ||
    venue.courtCount != null ||
    venue.refPricePerHour != null ||
    tel !== null;
  const directions = directionsUrl(venue);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 pb-28 md:pb-0">
      <Link
        href="/venues"
        className="text-muted-foreground inline-flex min-h-11 items-center gap-1 text-sm"
      >
        <ChevronLeft className="size-4" aria-hidden />
        {t("backToList")}
      </Link>

      <VenueMiniMap venue={venue} />

      <header className="space-y-1">
        <h1 className="text-2xl leading-tight font-bold break-words">
          {venue.name}
        </h1>
        {venue.areaLabel && (
          <p className="text-muted-foreground flex items-center gap-1.5 text-base">
            <MapPin className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 break-words">{venue.areaLabel}</span>
          </p>
        )}
      </header>

      {hasInfo && (
        <section className="bg-card/80 divide-border/60 divide-y rounded-2xl border px-4 shadow-sm backdrop-blur">
          {address && (
            <InfoRow
              variant="bare"
              wrapValue
              className={INFO_ROW}
              label={t("address")}
              value={address}
              valueClassName="text-base"
            />
          )}
          {hours && status && (
            <InfoRow
              variant="bare"
              wrapValue
              className={INFO_ROW}
              label={t("openHours")}
              valueClassName="text-base"
              value={
                // Giờ không đọc được vẫn hiện chữ gốc, nhưng không bao giờ
                // đoán thành "Đang mở".
                <VenueOpenStatus hours={hours} initialStatus={status} />
              }
            />
          )}
          {venue.courtCount != null && (
            <InfoRow
              variant="bare"
              wrapValue
              className={INFO_ROW}
              label={t("courtCount")}
              value={t("courtCountValue", { count: venue.courtCount })}
              valueClassName="text-base"
            />
          )}
          {venue.refPricePerHour != null && (
            <InfoRow
              variant="bare"
              wrapValue
              className={INFO_ROW}
              label={t("refPricePerHour")}
              value={`${formatK(venue.refPricePerHour)}đ`}
              valueClassName="text-base"
            />
          )}
          {tel && (
            // Cả hàng là link gọi để vùng chạm đủ lớn.
            <a href={`tel:${tel}`} className="block active:opacity-70">
              <InfoRow
                variant="bare"
                wrapValue
                className={INFO_ROW}
                label={t("phone")}
                value={
                  <span className="text-primary underline underline-offset-2">
                    {phoneText}
                  </span>
                }
                valueClassName="text-base"
              />
            </a>
          )}
        </section>
      )}

      {venue.amenities.length > 0 && (
        <section aria-labelledby="venue-amenities-title" className="space-y-2">
          <h2 id="venue-amenities-title" className="text-lg font-semibold">
            {t("amenitiesLabel")}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {venue.amenities.map((a) => {
              const Icon = AMENITY_ICONS[a];
              return (
                <li
                  key={a}
                  className="bg-card/80 flex items-center gap-2 rounded-full border px-3.5 py-2 text-base backdrop-blur"
                >
                  <Icon className="text-primary size-5 shrink-0" aria-hidden />
                  {t(`amenity.${a}`)}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {venue.photoLink && (
        <a
          href={venue.photoLink}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-primary inline-flex min-h-11 items-center gap-1.5 text-base underline-offset-2 hover:underline"
        >
          <ExternalLink className="size-4 shrink-0" aria-hidden />
          {t("photoLink")}
        </a>
      )}

      {/* Màn lớn: hàng nút có chữ nằm trong trang. */}
      <div
        data-testid="venue-actions"
        className="hidden flex-wrap gap-2 md:flex"
      >
        <a
          href={directions}
          target="_blank"
          rel="noopener noreferrer"
          className={`bg-primary text-primary-foreground ${ACTION}`}
        >
          <Navigation className="size-5" aria-hidden />
          {t("directions")}
        </a>
        {tel && (
          <a
            href={`tel:${tel}`}
            className={`bg-secondary text-secondary-foreground ${ACTION}`}
          >
            <Phone className="size-5" aria-hidden />
            {t("call")}
          </a>
        )}
        <VenueShareButton venueId={venue.id} name={venue.name} />
      </div>

      {exchanges && (
        <section aria-labelledby="venue-upcoming-title" className="space-y-3">
          <h2 id="venue-upcoming-title" className="text-lg font-semibold">
            {t("upcomingExchangesTitle")}
          </h2>
          {exchanges.length === 0 ? (
            <p className="bg-muted/40 text-muted-foreground flex items-center gap-3 rounded-2xl border border-dashed p-4 text-base">
              <CalendarX className="size-5 shrink-0" aria-hidden />
              {t("upcomingExchangesEmpty")}
            </p>
          ) : (
            <ul className="space-y-3">
              {exchanges.map((e) => (
                <li key={e.code}>
                  <ExchangeCard event={e} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Chỗ của đánh giá sân (G2d): giữ id và data-section để thay ruột sau. */}
      <section
        id="reviews"
        data-section="venue-reviews"
        aria-labelledby="venue-reviews-title"
        className="space-y-3"
      >
        <h2 id="venue-reviews-title" className="text-lg font-semibold">
          {t("reviewsTitle")}
        </h2>
        <p className="bg-muted/40 text-muted-foreground flex items-center gap-3 rounded-2xl border border-dashed p-4 text-base">
          <MessageSquareText className="size-5 shrink-0" aria-hidden />
          {t("reviewsSoon")}
        </p>
      </section>

      {/* Điện thoại: thanh nút dính đáy trong tầm ngón cái, chừa vạch home. */}
      <div
        data-testid="venue-action-bar"
        className="bg-background/95 fixed inset-x-0 bottom-0 z-30 border-t px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] backdrop-blur md:hidden"
      >
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <a
            href={directions}
            target="_blank"
            rel="noopener noreferrer"
            className={`bg-primary text-primary-foreground flex-1 ${ACTION}`}
          >
            <Navigation className="size-5" aria-hidden />
            {t("directions")}
          </a>
          {tel && (
            <a
              href={`tel:${tel}`}
              aria-label={t("call")}
              className="bg-secondary text-secondary-foreground inline-flex size-11 shrink-0 items-center justify-center rounded-xl active:scale-95"
            >
              <Phone className="size-5" aria-hidden />
            </a>
          )}
          <VenueShareButton venueId={venue.id} name={venue.name} />
        </div>
      </div>
    </div>
  );
}

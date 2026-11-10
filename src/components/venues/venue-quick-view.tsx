"use client";

import type { MouseEvent } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowLeft,
  CalendarClock,
  Navigation,
  Phone,
  Share2,
  X,
} from "lucide-react";
import { directionsUrl } from "@/lib/maps-link";
import { formatDistance } from "@/lib/geo";
import { formatK } from "@/lib/utils";
import { openStatus } from "@/lib/venues/open-hours";
import { toTelNumber } from "@/lib/venues/phone";
import { shareOrCopy } from "@/lib/share-link";
import { exchangeFeeText, exchangeWhenLabel } from "@/lib/exchange/format";
import type { ExchangeCard } from "@/lib/exchange/public-event";
import type { PublicVenue } from "@/lib/public-venue";
import { AMENITY_ICONS } from "./amenity-icons";

const MAX_UPCOMING = 3;
const actionClass =
  "bg-secondary text-secondary-foreground inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-base font-medium whitespace-nowrap active:scale-95";

/** Dòng một buổi giao lưu sắp tới tại sân, cả dòng là link. */
function UpcomingRow({
  event,
  locale,
}: {
  event: ExchangeCard;
  locale: string;
}) {
  const t = useTranslations("venues");
  const tx = useTranslations("exchange.search");
  const { counts } = event;
  const full = counts.freeTotal <= 0;
  return (
    <li>
      <Link
        href={`/exchanges/${event.code}`}
        className="bg-warning/15 active:bg-warning/25 block min-h-11 space-y-0.5 rounded-xl px-3 py-2 text-base"
      >
        <span className="flex items-center gap-1.5 font-medium">
          <CalendarClock className="size-4 shrink-0" aria-hidden />
          {exchangeWhenLabel(event.startAt, event.endAt, locale)}
        </span>
        <span className="text-muted-foreground block">
          {exchangeFeeText(event.fee, (key, values) => tx(key, values))}
          {" · "}
          {full
            ? t("slotsFull")
            : t("slotsLeftCount", { count: counts.freeTotal })}
          {!full && counts.freeFemaleOnly > 0 && (
            <>
              {" · "}
              {tx("femaleSlots", { count: counts.freeFemaleOnly })}
            </>
          )}
        </span>
      </Link>
    </li>
  );
}

function Upcoming({
  venueId,
  loadUpcoming,
  locale,
}: {
  venueId: number;
  loadUpcoming: (venueId: number) => Promise<ExchangeCard[]>;
  locale: string;
}) {
  const t = useTranslations("venues");
  // Không polling: mỗi lần mở thẻ tốn tối đa 1 lần đọc, cache 60 giây.
  const q = useQuery({
    queryKey: ["venue-upcoming", venueId],
    queryFn: () => loadUpcoming(venueId),
    staleTime: 60_000,
  });

  if (q.isPending) {
    return (
      <div
        className="space-y-2"
        aria-busy="true"
        data-testid="upcoming-skeleton"
      >
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-muted h-[60px] animate-pulse rounded-xl" />
        ))}
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className="space-y-2">
        <p className="text-destructive text-base">{t("upcomingLoadError")}</p>
        <button
          type="button"
          onClick={() => void q.refetch()}
          className={actionClass}
        >
          {t("retry")}
        </button>
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {q.data.slice(0, MAX_UPCOMING).map((e) => (
        <UpcomingRow key={e.code} event={e} locale={locale} />
      ))}
    </ul>
  );
}

/**
 * Thẻ xem nhanh một sân (mở khi bấm ghim hoặc thẻ). Danh sách giao lưu sắp tới
 * chỉ được tải khi sân có buổi sắp tới, để không tốn lượt đọc DB vô ích.
 */
export function VenueQuickView({
  venue,
  locale,
  exchangeCount,
  loadUpcoming,
  now,
  onClose,
  closeLabel,
  onViewDetails,
}: {
  venue: PublicVenue & { distanceM?: number };
  locale: "vi" | "en" | "zh";
  exchangeCount: number | undefined;
  loadUpcoming?: (venueId: number) => Promise<ExchangeCard[]>;
  now: Date;
  onClose: () => void;
  closeLabel: "close" | "back";
  /** Bấm "Xem chi tiết"; màn cha có thể `preventDefault` để tự điều hướng. */
  onViewDetails?: (e: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const t = useTranslations("venues");
  const activeLocale = useLocale();

  const status = venue.openHours ? openStatus(venue.openHours, now) : null;
  const phone = toTelNumber(venue.phone);

  async function handleShare() {
    const result = await shareOrCopy({
      title: venue.name,
      url: `${window.location.origin}/venues/${venue.id}`,
    });
    if (result === "copied") toast.success(t("shareCopied"));
    else if (result === "failed") toast.error(t("shareFailed"));
  }

  const CloseIcon = closeLabel === "close" ? X : ArrowLeft;
  const showUpcoming =
    loadUpcoming !== undefined &&
    exchangeCount !== undefined &&
    exchangeCount > 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-3 p-4"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="text-lg leading-snug font-semibold break-words">
            {venue.name}
          </h2>
          {venue.distanceM !== undefined && (
            <span className="bg-accent inline-block rounded-full px-2.5 py-0.5 text-sm font-medium tabular-nums">
              {formatDistance(venue.distanceM, locale)}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t(
            closeLabel === "close" ? "closeQuickView" : "backToList",
          )}
          className="hover:bg-accent inline-flex size-11 shrink-0 items-center justify-center rounded-full active:scale-95"
        >
          <CloseIcon className="size-5" aria-hidden />
        </button>
      </div>

      <div className="space-y-1 text-base">
        {venue.refPricePerHour != null && (
          <p>
            {t("pricePerHourValue", {
              price: `${formatK(venue.refPricePerHour)}đ`,
            })}
          </p>
        )}
        {status !== null && (
          <p className="text-muted-foreground">
            {status === "unknown"
              ? t("hoursUnknown")
              : t("openStatusWithHours", {
                  status: t(status === "open" ? "openNow" : "closedNow"),
                  hours: venue.openHours as string,
                })}
          </p>
        )}
      </div>

      {/* Ngay sau giá và giờ: thẻ mở ở nấc giữa, nơi ngăn không cuộn, nên
          nút hành động phải nằm trong phần đang lộ ra. */}
      <div className="flex flex-wrap gap-2">
        <a
          href={directionsUrl(venue)}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-primary text-primary-foreground inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-base font-medium whitespace-nowrap active:scale-95"
        >
          <Navigation className="size-5" aria-hidden />
          {t("directions")}
        </a>
        {phone && (
          <a href={`tel:${phone}`} className={actionClass}>
            <Phone className="size-5" aria-hidden />
            {t("call")}
          </a>
        )}
        <button type="button" onClick={handleShare} className={actionClass}>
          <Share2 className="size-5" aria-hidden />
          {t("share")}
        </button>
        <Link
          href={`/venues/${venue.id}`}
          onClick={onViewDetails}
          className={actionClass}
        >
          {t("viewDetails")}
        </Link>
      </div>

      {venue.amenities.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-2">
          {venue.amenities.map((a) => {
            const Icon = AMENITY_ICONS[a];
            return (
              <li key={a} className="flex items-center gap-1.5 text-base">
                <Icon className="text-muted-foreground size-5" aria-hidden />
                {t(`amenity.${a}`)}
              </li>
            );
          })}
        </ul>
      )}

      {showUpcoming && (
        <div className="space-y-2">
          <h3 className="text-base font-semibold">
            {t("upcomingExchangesTitle")}
          </h3>
          <Upcoming
            venueId={venue.id}
            loadUpcoming={loadUpcoming}
            locale={activeLocale}
          />
        </div>
      )}
    </motion.section>
  );
}

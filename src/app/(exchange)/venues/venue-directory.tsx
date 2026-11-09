"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  parseAsArrayOf,
  parseAsBoolean,
  parseAsNumberLiteral,
  parseAsStringLiteral,
  useQueryState,
} from "nuqs";
import { AnimatePresence, motion } from "framer-motion";
import { LocateFixed, MapPinned, Plus } from "lucide-react";
import { listVenuesNear } from "@/actions/venues";
import type { LatLng } from "@/lib/geo";
import { movedBeyond, venuesToPoints } from "@/lib/map/map-points";
import { VENUE_AMENITIES } from "@/lib/venue-amenities";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { VenueCard } from "@/components/venues/venue-card";
import { LocationFallback } from "@/components/venues/location-fallback";
import { useUserLocation } from "@/components/venues/use-user-location";
import { VenueMapPanel } from "./venue-map-panel";

const RADII = [3, 5, 10, 20] as const;
const VIEWS = ["list", "map"] as const;
/** Kéo bản đồ quá 30% bán kính thì mới đáng mời tìm lại ở khu vực mới. */
const SEARCH_HERE_RATIO = 0.3;

export function VenueDirectory({
  canSuggest,
  exchangeEnabled = false,
  loadExchangeCounts,
}: {
  canSuggest: boolean;
  /** Cờ giao lưu, do server component đọc một lần; tắt thì không có truy vấn thêm. */
  exchangeEnabled?: boolean;
  /** Server action đếm buổi theo sân, do page truyền xuống khi cờ bật; thiếu thì không có truy vấn. */
  loadExchangeCounts?: (ids: number[]) => Promise<[number, number][]>;
}) {
  const t = useTranslations("venues");
  const locale = useLocale() as "vi" | "en" | "zh";
  const [radius, setRadiusQuery] = useQueryState(
    "r",
    parseAsNumberLiteral(RADII).withDefault(5),
  );
  const [amenities, setAmenities] = useQueryState(
    "a",
    parseAsArrayOf(parseAsStringLiteral(VENUE_AMENITIES)).withDefault([]),
  );
  const [hasExchange, setHasExchange] = useQueryState(
    "exchange",
    parseAsBoolean.withDefault(false),
  );
  const [view, setView] = useQueryState(
    "view",
    parseAsStringLiteral(VIEWS).withDefault("list"),
  );
  const [searchCenter, setSearchCenter] = useState<LatLng | null>(null);
  const [mapCenter, setMapCenter] = useState<LatLng | null>(null);
  // Đổi bán kính làm bản đồ về lại tâm tìm kiếm; vị trí kéo cũ không còn đúng
  // với vùng đang thấy nên "Tìm ở khu vực này" phải ẩn.
  const setRadius = (r: (typeof RADII)[number]) => {
    setMapCenter(null);
    return setRadiusQuery(r);
  };
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Máy không dựng được bản đồ: khoá nút "Bản đồ" thay vì báo toast lặp lại.
  const [mapUnsupported, setMapUnsupported] = useState(false);
  const loc = useUserLocation();
  const { request } = loc;

  // Hỏi vị trí đúng một lần khi mở trang.
  useEffect(() => {
    request();
  }, [request]);

  const pos = loc.position;
  // Tâm "Tìm ở khu vực này" thắng GPS cho tới khi người dùng bấm về vị trí của tôi.
  const center = searchCenter ?? pos;
  const query = useQuery({
    queryKey: [
      "venues-near",
      center?.lat.toFixed(3),
      center?.lng.toFixed(3),
      radius,
      [...amenities].sort().join(","),
    ],
    queryFn: async () => {
      const r = await listVenuesNear({
        lat: center!.lat,
        lng: center!.lng,
        radiusKm: radius,
        amenities,
      });
      if ("error" in r) throw new Error(r.error);
      return r.venues;
    },
    enabled: loc.status === "ok" && center !== null,
    staleTime: 60_000,
    // Giữ ghim cũ trong lúc tải lại khi đổi khu vực/bán kính, khỏi nháy trống.
    placeholderData: keepPreviousData,
  });

  const venueIds = useMemo(
    () => (query.data ?? []).map((v) => v.id),
    [query.data],
  );
  // Số buổi theo sân đi qua một lời gọi riêng, không đụng listVenuesNear.
  const counts = useQuery({
    queryKey: ["venue-exchange-counts", venueIds],
    queryFn: async () => new Map(await loadExchangeCounts!(venueIds)),
    staleTime: 60_000,
    enabled: exchangeEnabled && !!loadExchangeCounts && venueIds.length > 0,
    // Giữ số cũ trong lúc tải lại khi đổi khu vực, khỏi nháy mất nhãn.
    placeholderData: keepPreviousData,
  });
  const countMap = exchangeEnabled ? counts.data : undefined;
  const countsFailed = counts.isError;
  // Đếm lỗi thì bỏ lọc, hiện danh sách đầy đủ thay vì báo "không có sân".
  const filterOn = exchangeEnabled && hasExchange && !countsFailed;
  const filterPending = filterOn && counts.isPending && venueIds.length > 0;

  const nextRadius = RADII.find((r) => r > radius);
  const isMap = view === "map" && !mapUnsupported;
  const showMap = isMap && loc.status === "ok" && center !== null;
  const allVenues = query.data ?? [];
  const venues = filterOn
    ? allVenues.filter((v) => (countMap?.get(v.id) ?? 0) > 0)
    : allVenues;
  const selectedVenue = venues.find((v) => v.id === selectedId) ?? null;
  const showSearchHere =
    showMap &&
    mapCenter !== null &&
    movedBeyond(mapCenter, center, radius * SEARCH_HERE_RATIO);

  const errorNotice = (
    <div className="flex flex-col items-center gap-3 text-center">
      <p className="text-base font-medium">{t("loadError")}</p>
      <Button className="min-h-11" onClick={() => query.refetch()}>
        {t("retry")}
      </Button>
    </div>
  );
  const emptyActions = (
    <div className="flex flex-wrap justify-center gap-2">
      {nextRadius && (
        <Button className="min-h-11" onClick={() => setRadius(nextRadius)}>
          {t("expandRadius")}
        </Button>
      )}
      {canSuggest && (
        <Link
          href="/venues/suggest"
          className="bg-card inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-medium"
        >
          {t("suggestVenue")}
        </Link>
      )}
    </div>
  );
  const emptyNotice = (
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="space-y-1">
        <p className="text-base font-medium">
          {t("emptyTitle", { km: radius })}
        </p>
        <p className="text-muted-foreground text-sm">{t("emptyDescription")}</p>
      </div>
      {emptyActions}
    </div>
  );
  const isEmpty = query.isSuccess && query.data.length === 0;
  const filteredEmpty =
    query.isSuccess &&
    query.data.length > 0 &&
    filterOn &&
    !filterPending &&
    venues.length === 0;
  // Ở chế độ bản đồ, bản đồ cao 60dvh đẩy khối lỗi/rỗng dưới nó ra ngoài
  // màn hình, nên hai trạng thái này hiện đè lên bản đồ.
  const mapNotice = query.isError ? errorNotice : isEmpty ? emptyNotice : null;

  function changeView(next: (typeof VIEWS)[number]) {
    // Bản đồ dựng lại từ đầu khi mở lại: bỏ vị trí kéo cũ và ghim đang chọn.
    setMapCenter(null);
    setSelectedId(null);
    setView(next);
  }

  function handleMapUnsupported() {
    setMapUnsupported(true);
    changeView("list");
  }

  return (
    <div className="space-y-4 pb-24">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{t("pageTitle")}</h1>
        <p className="text-muted-foreground text-base">{t("pageSubtitle")}</p>
      </header>

      <div
        role="group"
        aria-label={t("viewSwitch")}
        className="bg-muted grid grid-cols-2 gap-1 rounded-xl p-1"
      >
        {VIEWS.map((v) => {
          const disabled = v === "map" && mapUnsupported;
          return (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              disabled={disabled}
              aria-disabled={disabled}
              onClick={() => changeView(v)}
              className={cn(
                "min-h-11 rounded-lg text-base font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                view === v
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground",
              )}
            >
              {t(v === "list" ? "showList" : "showMap")}
            </button>
          );
        })}
      </div>
      {mapUnsupported && (
        <p className="text-muted-foreground text-sm" role="status">
          {t("mapUnsupported")}
        </p>
      )}

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

      {exchangeEnabled && countsFailed && hasExchange && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 text-sm"
        >
          <span className="text-muted-foreground">
            {t("exchangeFilterUnavailable")}
          </span>
          <button
            type="button"
            onClick={() => counts.refetch()}
            className="text-primary min-h-11 shrink-0 font-medium"
          >
            {t("retry")}
          </button>
        </div>
      )}

      {exchangeEnabled && (
        <div className="flex">
          <button
            type="button"
            aria-pressed={hasExchange}
            onClick={() => setHasExchange(hasExchange ? null : true)}
            className={cn(
              "min-h-11 rounded-full border px-4 text-sm font-medium transition-colors",
              hasExchange
                ? "bg-primary/15 border-primary text-primary"
                : "bg-card/80 hover:bg-accent",
            )}
          >
            {t("filterHasExchange")}
          </button>
        </div>
      )}

      {loc.status === "ok" && loc.label && (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground truncate">
            {searchCenter
              ? t("selectedArea")
              : t("searchingNear", { label: loc.label })}
          </span>
          <button
            type="button"
            onClick={() => {
              if (searchCenter) {
                setSearchCenter(null);
                setMapCenter(null);
              } else {
                request();
              }
            }}
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

      {showMap && center && (
        <VenueMapPanel
          points={venuesToPoints(venues)}
          center={center}
          radiusKm={radius}
          userPosition={pos}
          selectedVenue={selectedVenue}
          selectedId={selectedId}
          locale={locale}
          showSearchHere={showSearchHere}
          loading={query.isFetching}
          notice={mapNotice}
          onSelect={setSelectedId}
          onMoveEnd={setMapCenter}
          onSearchHere={() => {
            setSearchCenter(mapCenter);
            setSelectedId(null);
          }}
          onUnsupported={handleMapUnsupported}
        />
      )}

      {isMap && (loc.status === "asking" || loc.status === "idle") && (
        <Skeleton className="h-[60dvh] w-full rounded-2xl" />
      )}

      {!isMap &&
        (loc.status === "asking" ||
          loc.status === "idle" ||
          (loc.status === "ok" && query.isPending)) && <ListSkeleton />}

      {!isMap && query.isError && (
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

      {!isMap && isEmpty && (
        <EmptyState
          icon={MapPinned}
          title={t("emptyTitle", { km: radius })}
          description={t("emptyDescription")}
          action={emptyActions}
        />
      )}

      {!isMap && filterPending && query.isSuccess && <ListSkeleton />}

      {!isMap && filteredEmpty && (
        <EmptyState
          icon={MapPinned}
          title={t("emptyTitle", { km: radius })}
          description={t("emptyDescription")}
          action={emptyActions}
        />
      )}

      {query.isSuccess && venues.length > 0 && !isMap && (
        <ul className="grid gap-3 sm:grid-cols-2">
          <AnimatePresence initial={false}>
            {venues.map((v) => (
              <motion.li
                key={v.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <VenueCard
                  venue={v}
                  locale={locale}
                  upcomingExchangeCount={countMap?.get(v.id)}
                />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      {canSuggest && (
        <div className="bg-background/95 fixed inset-x-0 bottom-0 z-30 border-t p-3 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0">
          <Link
            href="/venues/suggest"
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

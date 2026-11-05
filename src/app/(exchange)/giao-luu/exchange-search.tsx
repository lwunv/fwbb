"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  parseAsNumberLiteral,
  parseAsStringLiteral,
  useQueryState,
} from "nuqs";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarClock, LocateFixed, Plus } from "lucide-react";
import { listExchangesNear } from "@/actions/exchange-read";
import type { LatLng } from "@/lib/geo";
import { hasWebGL2 } from "@/lib/map/webgl";
import { exchangesToPoints, movedBeyond } from "@/lib/map/map-points";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { ExchangeCard } from "@/components/exchange/exchange-card";
import { LocationFallback } from "@/components/venues/location-fallback";
import { useUserLocation } from "@/components/venues/use-user-location";
import { ExchangeFilters, useExchangeFilters } from "./exchange-filters";
import { ExchangeMapPanel } from "./exchange-map-panel";

const RADII = [3, 5, 10, 20] as const;
const VIEWS = ["list", "map"] as const;
/** Kéo bản đồ quá 30% bán kính thì mới đáng mời tìm lại ở khu vực mới. */
const SEARCH_HERE_RATIO = 0.3;

// Phía server luôn "có WebGL"; phía client đọc thật sau hydrate nên không lệch HTML.
const subscribeNone = () => () => {};

/**
 * Tìm buổi giao lưu quanh một điểm, xem dạng danh sách hoặc bản đồ. Danh sách
 * và bản đồ dùng chung một queryKey nên đổi qua lại không gọi server thêm.
 */
export function ExchangeSearch({ canOpenEvent }: { canOpenEvent: boolean }) {
  const t = useTranslations("exchange.search");
  const [radius, setRadiusQuery] = useQueryState(
    "r",
    parseAsNumberLiteral(RADII).withDefault(5),
  );
  const [view, setView] = useQueryState(
    "view",
    parseAsStringLiteral(VIEWS).withDefault("list"),
  );
  const filterState = useExchangeFilters();
  const { filters } = filterState;

  const [searchCenter, setSearchCenter] = useState<LatLng | null>(null);
  const [mapCenter, setMapCenter] = useState<LatLng | null>(null);
  // Đổi bán kính đưa bản đồ về tâm tìm kiếm; vị trí kéo cũ không còn đúng
  // với vùng đang thấy nên "Tìm ở khu vực này" phải ẩn.
  const setRadius = (r: (typeof RADII)[number]) => {
    setMapCenter(null);
    return setRadiusQuery(r);
  };
  const [selectedVenueId, setSelectedVenueId] = useState<number | null>(null);
  const noWebGL = useSyncExternalStore(
    subscribeNone,
    () => !hasWebGL2(),
    () => false,
  );
  const [mapFailed, setMapFailed] = useState(false);
  const mapUnsupported = noWebGL || mapFailed;
  const loc = useUserLocation();
  const { request } = loc;

  // Hỏi vị trí đúng một lần khi mở trang.
  useEffect(() => {
    request();
  }, [request]);

  const pos = loc.position;
  const center = searchCenter ?? pos;
  const query = useQuery({
    queryKey: [
      "exchange-near",
      center?.lat.toFixed(3),
      center?.lng.toFixed(3),
      radius,
      filters,
    ],
    queryFn: async () => {
      const r = await listExchangesNear({
        lat: center!.lat,
        lng: center!.lng,
        radiusKm: radius,
        ...filters,
      });
      if ("error" in r) throw new Error(r.error);
      return r.events;
    },
    enabled: loc.status === "ok" && center !== null,
    staleTime: 60_000,
    // Giữ ghim cũ trong lúc tải lại khi đổi khu vực/bán kính, khỏi nháy trống.
    placeholderData: keepPreviousData,
  });

  const nextRadius = RADII.find((r) => r > radius);
  const isMap = view === "map" && !mapUnsupported;
  const showMap = isMap && loc.status === "ok" && center !== null;
  const events = query.data ?? [];
  const selectedEvents = events.filter((e) => e.venue.id === selectedVenueId);
  const showSearchHere =
    showMap &&
    mapCenter !== null &&
    movedBeyond(mapCenter, center, radius * SEARCH_HERE_RATIO);

  const openLink = canOpenEvent && (
    <Link
      href="/giao-luu/mo"
      className="bg-primary text-primary-foreground inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-base font-medium"
    >
      <Plus className="h-4 w-4" aria-hidden />
      {t("openEvent")}
    </Link>
  );
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
      {openLink}
    </div>
  );
  const emptyNotice = (
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="space-y-1">
        <p className="text-base font-medium">{t("emptyTitle")}</p>
        <p className="text-muted-foreground text-base">
          {t("emptyDescription")}
        </p>
      </div>
      {emptyActions}
    </div>
  );
  const isEmpty = query.isSuccess && query.data.length === 0;
  // Ở chế độ bản đồ, bản đồ cao 60dvh đẩy khối lỗi/rỗng dưới nó ra ngoài màn
  // hình, nên hai trạng thái này hiện đè lên bản đồ.
  const mapNotice = query.isError ? errorNotice : isEmpty ? emptyNotice : null;

  function changeView(next: (typeof VIEWS)[number]) {
    setMapCenter(null);
    setSelectedVenueId(null);
    setView(next);
  }

  function handleMapUnsupported() {
    setMapFailed(true);
    changeView("list");
  }

  return (
    <div className="space-y-4">
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
        <p className="text-muted-foreground text-base" role="status">
          {t("mapUnsupported")}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{t("radius")}</span>
        {RADII.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={radius === r}
            onClick={() => setRadius(r)}
            className={cn(
              "min-h-11 rounded-full border px-4 text-base transition-colors",
              radius === r
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card/80 hover:bg-accent",
            )}
          >
            {t("radiusValue", { km: r })}
          </button>
        ))}
      </div>

      <ExchangeFilters state={filterState} />

      {loc.status === "ok" && loc.label && (
        <div className="flex items-center justify-between gap-2 text-base">
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
            <LocateFixed className="h-4 w-4" aria-hidden />
            {t("useMyLocation")}
          </button>
        </div>
      )}

      {(loc.status === "denied" || loc.status === "unsupported") && (
        <LocationFallback onLocated={loc.setManual} onRetryGps={request} />
      )}

      {loc.status === "asking" && (
        <p className="text-muted-foreground text-base" role="status">
          {t("locating")}
        </p>
      )}

      {showMap && center && (
        <ExchangeMapPanel
          points={exchangesToPoints(events)}
          center={center}
          radiusKm={radius}
          userPosition={pos}
          selectedVenueId={selectedVenueId}
          selectedEvents={selectedEvents}
          showSearchHere={showSearchHere}
          loading={query.isFetching}
          notice={mapNotice}
          onSelect={setSelectedVenueId}
          onMoveEnd={setMapCenter}
          onSearchHere={() => {
            setSearchCenter(mapCenter);
            setSelectedVenueId(null);
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
          icon={CalendarClock}
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
          icon={CalendarClock}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={emptyActions}
        />
      )}

      {query.isSuccess && query.data.length > 0 && !isMap && (
        <ul className="grid gap-3 sm:grid-cols-2">
          <AnimatePresence initial={false}>
            {query.data.map((e) => (
              <motion.li
                key={e.code}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <ExchangeCard event={e} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      {canOpenEvent && (
        <div className="bg-background/95 fixed inset-x-0 bottom-0 z-30 border-t p-3 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0">
          <Link
            href="/giao-luu/mo"
            className="bg-primary text-primary-foreground flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-medium sm:w-auto sm:px-6"
          >
            <Plus className="h-5 w-5" aria-hidden />
            {t("openEvent")}
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
        <li key={i} className="bg-card space-y-3 rounded-2xl border p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-5 w-2/5" />
              <Skeleton className="h-6 w-4/5" />
            </div>
            <Skeleton className="h-8 w-20 rounded-full" />
          </div>
          <Skeleton className="h-6 w-3/5" />
          <Skeleton className="h-6 w-24 rounded-md" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-7 w-2/5" />
        </li>
      ))}
    </ul>
  );
}

"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, LocateFixed, MapPinned, Plus, Search } from "lucide-react";
import type { ExchangeCard } from "@/lib/exchange/public-event";
import { VENUE_RADII } from "@/lib/venues/directory-state";
import { snapOffsets, type SheetSnap } from "@/lib/venues/sheet-snap";
import { useMediaQuery } from "@/lib/use-media-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LazyMapView } from "@/components/map/lazy-map-view";
import { VenueCard } from "@/components/venues/venue-card";
import { VenueFilterChips } from "@/components/venues/venue-filter-chips";
import { VenueQuickView } from "@/components/venues/venue-quick-view";
import { VenueSearchBar } from "@/components/venues/venue-search-bar";
import { VenueSheet } from "@/components/venues/venue-sheet";
import { useVenueDirectoryState } from "./use-venue-directory-state";

/** Khoảng hở giữa đáy lớp nổi và mép trên ngăn ở nấc cao. */
const OVERLAY_GAP_PX = 8;

const PILL =
  "bg-card/90 inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium shadow-lg backdrop-blur";

/**
 * Khung trang: phủ phần dưới header app (56px). Lưới 2 cột chỉ bật từ `md:`,
 * nên HTML server giống nhau trên mọi bề rộng.
 */
const FRAME =
  "fixed inset-x-0 top-14 bottom-0 overflow-hidden md:grid md:grid-cols-[400px_minmax(0,1fr)]";
/**
 * Ô nguồn bản đồ (bắt buộc nhìn thấy) đẩy lên trên phần ngăn đang che. Cần `!`:
 * maplibre-gl.css không nằm trong layer nào nên luôn thắng utility của
 * Tailwind (nằm trong `@layer utilities`), bất kể độ đặc hiệu.
 */
const MAP_WRAPPER =
  "relative isolate h-full md:col-start-2 md:row-start-1 [&_.maplibregl-ctrl-bottom-right]:bottom-[var(--venues-map-inset)]!";

/** Ô tìm, hàng chip và ngăn ở nấc thấp, giữ chỗ trước khi biết bề rộng máy. */
function PanelSkeleton() {
  return (
    <div
      data-testid="venues-panel-skeleton"
      aria-hidden
      className="pointer-events-none absolute inset-0 z-20 md:hidden"
    >
      <div className="space-y-2 px-3 pt-3">
        <Skeleton className="h-11 w-full rounded-full" />
        <div className="flex gap-2 overflow-hidden">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-11 w-28 shrink-0 rounded-full" />
          ))}
        </div>
      </div>
      <div className="bg-card/95 border-border/60 absolute inset-x-0 bottom-0 flex h-[72px] flex-col items-center gap-3 rounded-t-3xl border border-b-0 pt-2">
        <span className="bg-muted-foreground/40 h-1.5 w-10 rounded-full" />
        <Skeleton className="h-5 w-36" />
      </div>
    </div>
  );
}

/** Khung skeleton cả trang (dùng cho `loading.tsx` của route). */
export function VenueDirectorySkeleton() {
  return (
    <div className={FRAME}>
      <div className={MAP_WRAPPER}>
        <Skeleton className="absolute inset-0 rounded-none" />
      </div>
      <PanelSkeleton />
    </div>
  );
}

function CardSkeletons() {
  return (
    <ul className="space-y-2" aria-hidden>
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          data-testid="venue-card-skeleton"
          className="bg-card/80 flex items-start gap-2 rounded-xl border p-3"
        >
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-3/5" />
            <Skeleton className="h-5 w-4/5" />
            <Skeleton className="h-5 w-2/5" />
          </div>
          <Skeleton className="size-11 shrink-0 rounded-full" />
        </li>
      ))}
    </ul>
  );
}

/**
 * Danh bạ sân, bản đồ trước. Điện thoại: bản đồ phủ khung, lớp nổi (ô tìm,
 * chip, hàng trạng thái) ở trên, ngăn kéo danh sách ở dưới. Desktop (`md:`):
 * cột trái dành cho danh sách, bản đồ bên phải.
 *
 * Mọi dữ liệu và quota nằm trong `useVenueDirectoryState`; màn này chỉ ghép
 * giao diện và giữ nấc ngăn kéo.
 */
export function VenueDirectory({
  canSuggest,
  exchangeEnabled = false,
  loadExchangeCounts,
  loadUpcoming,
}: {
  canSuggest: boolean;
  /** Cờ giao lưu, do server component đọc một lần; tắt thì không có truy vấn thêm. */
  exchangeEnabled?: boolean;
  /** Server action đếm buổi theo sân, do page truyền xuống khi cờ bật; thiếu thì không có truy vấn. */
  loadExchangeCounts?: (ids: number[]) => Promise<[number, number][]>;
  /** Server action buổi sắp tới tại một sân, cho thẻ xem nhanh; chỉ có khi cờ bật. */
  loadUpcoming?: (venueId: number) => Promise<ExchangeCard[]>;
}) {
  const t = useTranslations("venues");
  const locale = useLocale() as "vi" | "en" | "zh";
  const s = useVenueDirectoryState({ exchangeEnabled, loadExchangeCounts });
  // Chỉ quyết nội dung panel; khung và lưới dựng bằng class `md:`.
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const mobile = isDesktop === false;

  const [snap, setSnap] = useState<SheetSnap>("low");
  const [searchFocused, setSearchFocused] = useState(false);
  // Nấc trước khi ô tìm được focus, để trả lại khi rời ô.
  const snapBeforeFocus = useRef<SheetSnap | null>(null);

  const frameRef = useRef<HTMLDivElement>(null);
  /** Khối ô tìm + hàng chip: đáy của nó là chỗ ngăn dừng ở nấc cao. */
  const controlsRef = useRef<HTMLDivElement>(null);
  const [frameH, setFrameH] = useState(0);
  const [topReserve, setTopReserve] = useState(OVERLAY_GAP_PX);
  const [visibleH, setVisibleH] = useState(0);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => {
      setFrameH(frame.clientHeight || window.innerHeight);
      // offsetParent của khối là lớp nổi, mà lớp nổi nằm sát đỉnh khung, nên
      // offsetTop cũng là khoảng cách tới đỉnh khung.
      const block = controlsRef.current;
      setTopReserve(
        block
          ? block.offsetTop + block.offsetHeight + OVERLAY_GAP_PX
          : OVERLAY_GAP_PX,
      );
    };
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(measure);
      ro.observe(frame);
      if (controlsRef.current) ro.observe(controlsRef.current);
      return () => ro.disconnect();
    }
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
    };
  }, [mobile]);

  // Link có `?venue=`: thẻ xem nhanh mở ở nấc giữa. Cờ chỉ bật một lần.
  const [linkShown, setLinkShown] = useState(false);
  if (s.openedFromLink && !linkShown) {
    setLinkShown(true);
    if (snap !== "mid") setSnap("mid");
  }

  const { query } = s;
  const data = query.data;
  const settledData = query.isSuccess && !query.isPlaceholderData;
  const isEmpty = settledData && data !== undefined && data.length === 0;
  const filteredEmpty =
    settledData &&
    data !== undefined &&
    data.length > 0 &&
    !s.exchangeFilterPending &&
    s.venues.length === 0;
  const listLoading = query.isPending || s.exchangeFilterPending;

  // Lỗi tải hoặc không có sân: lời nhắn nằm trong ngăn, nên ngăn tự lên nấc
  // giữa đúng một lần cho mỗi kết quả (người dùng hạ xuống thì không bị kéo lại).
  const noticeKey = query.isError
    ? `error:${query.errorUpdatedAt}`
    : isEmpty || filteredEmpty
      ? `empty:${query.dataUpdatedAt}:${s.exchange}:${s.openNow}`
      : null;
  const [raisedKey, setRaisedKey] = useState<string | null>(null);
  if (noticeKey !== null && noticeKey !== raisedKey && !searchFocused) {
    setRaisedKey(noticeKey);
    if (snap === "low") setSnap("mid");
  }

  function selectVenue(id: number) {
    s.select(id);
    // Chọn từ gợi ý của ô tìm: ô sắp mất focus và trả nấc cũ, nên đổi nấc
    // cần trả về thay vì đổi nấc ngay.
    if (searchFocused) snapBeforeFocus.current = "mid";
    else setSnap("mid");
  }

  /**
   * Nấc do người dùng chọn (kéo, bấm tiêu đề). Ô tìm có thể vẫn giữ focus khi
   * bàn phím đã ẩn (nút Back của Android), nên nấc này cũng là nấc trả về lúc
   * rời ô, thay vì nấc trước khi focus.
   */
  function userSnap(next: SheetSnap) {
    if (searchFocused) snapBeforeFocus.current = next;
    setSnap(next);
  }

  function onSearchFocus(focused: boolean) {
    if (focused) {
      if (!searchFocused) snapBeforeFocus.current = snap;
      setSearchFocused(true);
      setSnap("low");
      return;
    }
    const back = snapBeforeFocus.current;
    snapBeforeFocus.current = null;
    setSearchFocused(false);
    if (back) setSnap(back);
  }

  const midVisible = frameH - snapOffsets(frameH, topReserve).mid;
  // Phần đáy bản đồ bị ngăn che, chặn ở nấc giữa: kéo lên cao không đẩy tâm
  // bản đồ lên mãi.
  const bottomInset = mobile ? Math.max(0, Math.min(visibleH, midVisible)) : 0;

  const frameStyle = {
    "--venues-top-reserve": `${topReserve}px`,
    "--venues-map-inset": `${bottomInset}px`,
  } as CSSProperties;

  const selected = s.selectedVenue;
  const nextRadius = VENUE_RADII.find((r) => r > s.radius);

  let viewingLine: string | null = null;
  if ((s.source === "stored" || s.source === "default") && !s.gpsWaiting) {
    viewingLine = t("viewingAround", {
      label: s.areaLabel ?? t("defaultAreaLabel"),
    });
  } else if (s.source === "url" && s.areaLabel) {
    viewingLine = t("viewingPlace", { label: s.areaLabel });
  }

  const sheetTitle =
    listLoading || query.isError
      ? t("pageTitle")
      : t("sheetCount", { count: s.venues.length });

  const suggestLink = canSuggest && (
    <Link
      href="/venues/suggest"
      className="bg-card text-primary inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 text-base font-medium"
    >
      <Plus className="size-5" aria-hidden />
      {t("suggestVenue")}
    </Link>
  );

  let listBody;
  if (query.isError) {
    listBody = (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <MapPinned className="text-muted-foreground size-8" aria-hidden />
        <p className="text-base font-medium">{t("loadError")}</p>
        <Button className="min-h-11" onClick={() => void query.refetch()}>
          {t("retry")}
        </Button>
      </div>
    );
  } else if (listLoading) {
    listBody = <CardSkeletons />;
  } else if (isEmpty || filteredEmpty) {
    listBody = (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <MapPinned className="text-muted-foreground size-8" aria-hidden />
        <div className="space-y-1">
          <p className="text-base font-medium">
            {t("emptyTitle", { km: s.radius })}
          </p>
          <p className="text-muted-foreground text-base">
            {t("emptyDescription")}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {nextRadius && (
            <Button
              className="min-h-11"
              onClick={() => s.setRadius(nextRadius)}
            >
              {t("expandRadius")}
            </Button>
          )}
          {suggestLink}
        </div>
      </div>
    );
  } else {
    listBody = (
      <div className="space-y-3">
        <ul className="space-y-2">
          {s.venues.map((v) => (
            <motion.li
              key={v.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <VenueCard
                venue={v}
                locale={locale}
                upcomingExchangeCount={s.counts?.get(v.id)}
                now={s.now}
                onSelect={() => selectVenue(v.id)}
                selected={v.id === s.selectedId}
              />
            </motion.li>
          ))}
        </ul>
        {suggestLink && (
          <div className="flex justify-center">{suggestLink}</div>
        )}
      </div>
    );
  }

  return (
    <div ref={frameRef} className={FRAME} style={frameStyle}>
      <h1 className="sr-only">{t("pageTitle")}</h1>

      <div className={MAP_WRAPPER}>
        {isDesktop === null ? (
          // HTML server không phụ thuộc WebGL hay bề rộng: bản đồ chỉ dựng ở client.
          <Skeleton className="absolute inset-0 rounded-none" />
        ) : (
          <LazyMapView
            points={s.points}
            center={s.center}
            radiusKm={s.radius}
            userPosition={s.gps}
            selectedId={s.selectedId}
            onPointClick={(p) => selectVenue(p.id)}
            onMoveEnd={s.onMoveEnd}
            // Bản đồ phủ cả màn: một ngón là kéo bản đồ, không còn trang để cuộn.
            cooperativeGestures={false}
            focus={s.focus}
            bottomInset={bottomInset}
            noticeClassName="top-[var(--venues-top-reserve)]"
            className="h-full rounded-none border-0"
          />
        )}
      </div>

      {isDesktop === null && <PanelSkeleton />}

      {mobile && (
        <>
          <div
            data-testid="venues-overlay"
            className="pointer-events-none absolute inset-x-0 top-0 z-20 px-3 pt-3"
          >
            {/* Chỉ ô tìm và hàng chip được đo cho nấc cao. Hàng trạng thái nằm
                tuyệt đối ngay dưới khối này (không chiếm chỗ, flex gap bỏ qua
                phần tử tuyệt đối), nên viên "Đang tải" hiện/ẩn không làm mép
                ngăn nhảy. */}
            <div ref={controlsRef} className="relative flex flex-col gap-2">
              <div className="pointer-events-auto">
                <VenueSearchBar
                  venues={s.venues}
                  locale={locale}
                  onPickVenue={selectVenue}
                  onPlace={s.placeSearched}
                  onLocate={s.locate}
                  locating={s.locating || s.gpsWaiting}
                  onFocusChange={onSearchFocus}
                />
              </div>
              {/* Hàng chip phủ cả bề ngang: chỗ trống giữa các chip vẫn kéo được bản đồ. */}
              <div
                data-testid="venues-chip-row"
                className="pointer-events-none [&_button]:pointer-events-auto"
              >
                <VenueFilterChips
                  radius={s.radius}
                  onRadius={s.setRadius}
                  amenities={s.amenities}
                  onAmenities={s.setAmenities}
                  exchange={s.exchange}
                  onExchange={s.setExchange}
                  showExchange={exchangeEnabled}
                  openNow={s.openNow}
                  onOpenNow={s.setOpenNow}
                />
              </div>
              {/* Ở nấc cao ngăn che gần hết bản đồ: các dòng này không còn gì để
                chú thích và không được đè lên danh sách. */}
              {snap !== "high" && (
                <div
                  data-testid="venues-status-row"
                  className="absolute inset-x-0 top-full mt-2 flex flex-col items-center gap-2"
                >
                  {query.isFetching ? (
                    <motion.div
                      key="loading"
                      role="status"
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`${PILL} pointer-events-none`}
                    >
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                      {t("loadingVenues")}
                    </motion.div>
                  ) : (
                    s.showSearchHere && (
                      <motion.button
                        key="search-here"
                        type="button"
                        onClick={s.searchHere}
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        whileTap={{ scale: 0.97 }}
                        className="bg-primary text-primary-foreground pointer-events-auto inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-base font-medium shadow-lg"
                      >
                        <Search className="size-4" aria-hidden />
                        {t("searchThisArea")}
                      </motion.button>
                    )
                  )}
                  {(s.gpsWaiting || s.locating) && (
                    <p role="status" className={`${PILL} pointer-events-none`}>
                      <LocateFixed
                        className="size-4 animate-pulse"
                        aria-hidden
                      />
                      {t("locating")}
                    </p>
                  )}
                  {viewingLine && (
                    <p className="bg-card/85 text-muted-foreground pointer-events-none max-w-full rounded-xl border px-3 py-1.5 text-center text-sm shadow-sm backdrop-blur">
                      {viewingLine}
                    </p>
                  )}
                  {s.locateFailed && (
                    <p
                      role="status"
                      className="bg-card/90 pointer-events-none max-w-full rounded-xl border px-3 py-1.5 text-center text-sm shadow-sm backdrop-blur"
                    >
                      {t("locationUnavailable")}
                    </p>
                  )}
                  {s.countsFailed && s.exchange && (
                    <div
                      role="status"
                      className="bg-card/90 pointer-events-none flex max-w-full items-center gap-2 rounded-xl border py-1 pr-1 pl-3 text-sm shadow-sm backdrop-blur"
                    >
                      <span className="text-muted-foreground">
                        {t("exchangeFilterUnavailable")}
                      </span>
                      <button
                        type="button"
                        onClick={s.retryCounts}
                        className="text-primary pointer-events-auto min-h-11 shrink-0 rounded-lg px-3 font-medium"
                      >
                        {t("retry")}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <VenueSheet
            snap={snap}
            onSnapChange={userSnap}
            title={sheetTitle}
            topReserve={topReserve}
            frozen={searchFocused}
            onVisibleHeight={setVisibleH}
            onDragClose={
              selected
                ? () => {
                    s.clearSelection();
                    userSnap("low");
                  }
                : undefined
            }
          >
            <div className="px-3 pb-3">
              <AnimatePresence mode="wait" initial={false}>
                {selected ? (
                  <motion.div
                    key={`venue-${selected.id}`}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 12 }}
                    transition={{ duration: 0.15 }}
                  >
                    <VenueQuickView
                      venue={selected}
                      locale={locale}
                      exchangeCount={s.counts?.get(selected.id)}
                      loadUpcoming={loadUpcoming}
                      now={s.now}
                      onClose={s.clearSelection}
                      closeLabel="close"
                    />
                  </motion.div>
                ) : (
                  <motion.div
                    key="list"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    {listBody}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </VenueSheet>
        </>
      )}
    </div>
  );
}

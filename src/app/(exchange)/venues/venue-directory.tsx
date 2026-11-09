"use client";

import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AnimatePresence, motion } from "framer-motion";
import {
  Loader2,
  LocateFixed,
  MapPinOff,
  MapPinned,
  Plus,
  Search,
} from "lucide-react";
import type { ExchangeCard } from "@/lib/exchange/public-event";
import { useWebGL2Support } from "@/lib/map/webgl";
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
/**
 * Desktop: khối "Không tải được nền bản đồ" nằm dưới viên nổi trên bản đồ
 * (top-3 + viên cao 44px + khoảng hở 8px).
 */
const DESKTOP_NOTICE_TOP_PX = 64;

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

/**
 * Bọc ô tìm. `relative z-10`: danh sách gợi ý (tuyệt đối, ngay dưới ô) phải
 * nằm trên những gì vẽ sau nó trong cây (hàng chip, hàng trạng thái, thẻ sân có
 * nút Chỉ đường `z-10`), không thì bị đè và chạm vào gợi ý lại trúng thứ khác.
 */
const SEARCH_WRAPPER = "pointer-events-auto relative z-10";

/** Cột trái desktop (từ `md:`), dùng cho cả bản thật lẫn skeleton. */
const COLUMN =
  "bg-background hidden min-h-0 flex-col border-r md:col-start-1 md:row-start-1 md:flex";

/**
 * Giữ chỗ trước khi biết bề rộng máy: điện thoại thì ô tìm, hàng chip và ngăn
 * ở nấc thấp; từ `md:` thì cột trái (ô tìm, chip, 3 thẻ gọn). Hai phần bật/tắt
 * bằng class nên HTML server giống nhau trên mọi bề rộng.
 */
function PanelSkeleton() {
  return (
    <>
      <MobilePanelSkeleton />
      <div data-testid="venues-column-skeleton" aria-hidden className={COLUMN}>
        <div className="flex flex-col gap-2 p-3">
          <Skeleton className="h-11 w-full rounded-full" />
          <div className="flex gap-2 overflow-hidden">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-11 w-28 shrink-0 rounded-full" />
            ))}
          </div>
        </div>
        <div className="space-y-2 px-3 pb-3">
          <Skeleton className="h-6 w-36" />
          <CardSkeletons />
        </div>
      </div>
    </>
  );
}

function MobilePanelSkeleton() {
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

/**
 * Ô tìm của trang danh sách (máy không có WebGL): không có thẻ xem nhanh trên
 * bản đồ nên chọn tên sân thì mở trang chi tiết, như bấm tên trên thẻ.
 */
function DetailLinkSearchBar(
  props: Omit<ComponentProps<typeof VenueSearchBar>, "onPickVenue">,
) {
  const router = useRouter();
  return (
    <VenueSearchBar
      {...props}
      onPickVenue={(id) => router.push(`/venues/${id}`)}
    />
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
 * cột trái có ô tìm, chip, hàng trạng thái và danh sách (hoặc thẻ xem nhanh),
 * bản đồ bên phải. Bản đồ giữ một chỗ trong cây nên đổi bố cục không dựng lại.
 * Máy không có WebGL2 (hoặc bản đồ báo không dựng được): trang danh sách cuộn
 * thường, không bao giờ có khung bản đồ trống.
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
  const desktop = isDesktop === true;
  // Server và lần hydrate coi như có WebGL2 (khung bản đồ); máy không có thì
  // ngay sau hydrate rơi về trang danh sách và bản đồ không bao giờ được dựng.
  const webgl = useWebGL2Support();
  // Có WebGL2 nhưng maplibre vẫn không dựng được (MapView báo onUnsupported).
  const [mapFailed, setMapFailed] = useState(false);
  const listOnly = !webgl || mapFailed;

  const [snap, setSnap] = useState<SheetSnap>("low");
  const [searchFocused, setSearchFocused] = useState(false);
  // Nấc trước khi ô tìm được focus, để trả lại khi rời ô.
  const snapBeforeFocus = useRef<SheetSnap | null>(null);
  // Ô tìm của điện thoại bị gỡ khi đổi bố cục (vd xoay ngang qua 768px) mà
  // không báo blur: bỏ trạng thái focus, kẻo ngăn bị đóng băng khi quay lại.
  if (searchFocused && (!mobile || listOnly)) setSearchFocused(false);

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
  }, [mobile, listOnly]);

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
    "--venues-top-reserve": `${desktop ? DESKTOP_NOTICE_TOP_PX : topReserve}px`,
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

  /** `selectable`: thẻ là nút chọn sân (có bản đồ); không thì tên mở trang chi tiết. */
  function renderList(selectable: boolean) {
    if (query.isError) {
      return (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <MapPinned className="text-muted-foreground size-8" aria-hidden />
          <p className="text-base font-medium">{t("loadError")}</p>
          <Button className="min-h-11" onClick={() => void query.refetch()}>
            {t("retry")}
          </Button>
        </div>
      );
    }
    if (listLoading) return <CardSkeletons />;
    if (isEmpty || filteredEmpty) {
      return (
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
    }
    return (
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
                onSelect={selectable ? () => selectVenue(v.id) : undefined}
                selected={selectable && v.id === s.selectedId}
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

  const searchProps = {
    venues: s.venues,
    locale,
    onPlace: s.placeSearched,
    onLocate: s.locate,
    locating: s.locating || s.gpsWaiting,
  };

  const chips = (
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
  );

  // Viên nổi trên bản đồ: "Đang tải" thay chỗ "Tìm ở khu vực này".
  const mapPill = query.isFetching ? (
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
  );

  const locatingLine = (s.gpsWaiting || s.locating) && (
    <p role="status" className={`${PILL} pointer-events-none`}>
      <LocateFixed className="size-4 animate-pulse" aria-hidden />
      {t("locating")}
    </p>
  );
  const viewingP = viewingLine && (
    <p className="bg-card/85 text-muted-foreground pointer-events-none max-w-full rounded-xl border px-3 py-1.5 text-center text-sm shadow-sm backdrop-blur">
      {viewingLine}
    </p>
  );
  const locateFailedLine = s.locateFailed && (
    <p
      role="status"
      className="bg-card/90 pointer-events-none max-w-full rounded-xl border px-3 py-1.5 text-center text-sm shadow-sm backdrop-blur"
    >
      {t("locationUnavailable")}
    </p>
  );
  const countsFailedLine = s.countsFailed && s.exchange && (
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
  );

  /** Danh sách hoặc thẻ xem nhanh: nội dung của ngăn kéo và của cột trái. */
  function panelBody(closeLabel: "close" | "back", listHeader?: ReactNode) {
    return (
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
              closeLabel={closeLabel}
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
            {listHeader}
            {renderList(true)}
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  if (listOnly) {
    return (
      <div
        data-testid="venues-list-page"
        className="mx-auto w-full max-w-2xl space-y-3"
      >
        <h1 className="text-2xl font-bold">{t("pageTitle")}</h1>
        <div className={SEARCH_WRAPPER}>
          <DetailLinkSearchBar {...searchProps} />
        </div>
        {chips}
        <p
          role="status"
          className="text-muted-foreground flex items-start gap-2 text-base"
        >
          <MapPinOff className="mt-0.5 size-5 shrink-0" aria-hidden />
          {t("mapUnsupported")}
        </p>
        <div className="flex flex-col items-start gap-2 empty:hidden">
          {mapPill}
          {locatingLine}
          {viewingP}
          {locateFailedLine}
          {countsFailedLine}
        </div>
        {/* Thẻ có nút z-10: giam trong lớp riêng để gợi ý của ô tìm nằm trên. */}
        <div className="isolate">{renderList(false)}</div>
        {/* Không có bản đồ (và ô nguồn của nó) nên nguồn toạ độ địa chỉ ghi ở đây. */}
        <p className="text-muted-foreground text-sm">{t("attribution")}</p>
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
            onUnsupported={() => setMapFailed(true)}
          />
        )}
        {desktop && (
          <div
            data-testid="venues-map-pills"
            className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-3"
          >
            {mapPill}
          </div>
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
                  {...searchProps}
                  onPickVenue={selectVenue}
                  onFocusChange={onSearchFocus}
                />
              </div>
              {/* Hàng chip phủ cả bề ngang: chỗ trống giữa các chip vẫn kéo được bản đồ. */}
              <div
                data-testid="venues-chip-row"
                className="pointer-events-none [&_button]:pointer-events-auto"
              >
                {chips}
              </div>
              {/* Ở nấc cao ngăn che gần hết bản đồ: các dòng này không còn gì để
                chú thích và không được đè lên danh sách. */}
              {snap !== "high" && (
                <div
                  data-testid="venues-status-row"
                  className="absolute inset-x-0 top-full mt-2 flex flex-col items-center gap-2"
                >
                  {mapPill}
                  {locatingLine}
                  {viewingP}
                  {locateFailedLine}
                  {countsFailedLine}
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
            <div className="px-3 pb-3">{panelBody("close")}</div>
          </VenueSheet>
        </>
      )}

      {desktop && (
        <div data-testid="venues-column" className={COLUMN}>
          <div className="flex flex-col gap-2 p-3">
            <div className={SEARCH_WRAPPER}>
              <VenueSearchBar {...searchProps} onPickVenue={selectVenue} />
            </div>
            {chips}
            <div className="flex flex-col items-start gap-2 empty:hidden">
              {locatingLine}
              {viewingP}
              {locateFailedLine}
              {countsFailedLine}
            </div>
          </div>
          {/* Thẻ có nút z-10: giam trong lớp riêng để gợi ý của ô tìm nằm trên. */}
          <div className="isolate min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            {panelBody(
              "back",
              <h2 className="mb-2 text-base font-semibold">{sheetTitle}</h2>,
            )}
          </div>
        </div>
      )}
    </div>
  );
}

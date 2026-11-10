"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { listVenuesNear } from "@/actions/venues";
import type { LatLng } from "@/lib/geo";
import type { PublicVenue } from "@/lib/public-venue";
import type { VenueAmenity } from "@/lib/venue-amenities";
import { isInVietnamOrIslands } from "@/lib/map/island-label";
import { movedBeyond, venuesToPointsWithExchanges } from "@/lib/map/map-points";
import {
  SEARCH_HERE_RATIO,
  filterVenues,
  parseUrlCenter,
  readStoredArea,
  resolveCenter,
  roundCoord,
  writeStoredArea,
  type StoredArea,
  type VenueRadius,
} from "@/lib/venues/directory-state";
import { useUserLocation } from "@/components/venues/use-user-location";
import { useVenueUrlState } from "./use-venue-url-state";

/** Sân trong kết quả `listVenuesNear`, kèm khoảng cách tới tâm tìm (mét). */
export type DirectoryVenue = PublicVenue & { distanceM: number };

type GpsPermission = "unknown" | "granted" | "other";

/**
 * Hạn chờ API quyền. Trình duyệt nhúng của Zalo/Messenger có lúc không bao giờ
 * trả lời `permissions.query`; quá hạn thì coi như chưa được cấp để tải vùng
 * dự phòng thay vì để trang trống.
 */
const PERMISSION_TIMEOUT_MS = 500;

function sameSpot(a: LatLng, b: LatLng): boolean {
  return a.lat === b.lat && a.lng === b.lng;
}

/**
 * Toàn bộ trạng thái và dữ liệu của màn danh bạ sân (bản đồ trước).
 *
 * Quota Turso: mỗi lần mở trang chỉ một `listVenuesNear`, bắn sau khi đã đọc
 * vùng đã lưu và biết quyền GPS (quyền đã cấp thì chờ GPS, không tải vùng dự
 * phòng trước). Kéo/zoom không gọi server, chỉ "Tìm ở khu vực này" mới gọi.
 * Không hẹn giờ lặp, không polling.
 */
export function useVenueDirectoryState({
  exchangeEnabled,
  loadExchangeCounts,
}: {
  exchangeEnabled: boolean;
  loadExchangeCounts?: (ids: number[]) => Promise<[number, number][]>;
}) {
  const t = useTranslations("venues");
  const [url, setUrl] = useVenueUrlState();
  const loc = useUserLocation();
  const { request } = loc;

  // Hỏi vị trí đúng một lần khi mở trang.
  useEffect(() => {
    request();
  }, [request]);

  const [stored, setStored] = useState<StoredArea | null>(null);
  const [initReady, setInitReady] = useState(false);
  useEffect(() => {
    // localStorage chỉ có ở client: đọc sau khi mount để HTML server khớp lần
    // vẽ đầu; `initReady` chặn lần tải đầu tới lúc đọc xong.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of a client-only store after hydration.
    setStored(readStoredArea());
    setInitReady(true);
  }, []);

  const [gpsPermission, setGpsPermission] = useState<GpsPermission>("unknown");
  useEffect(() => {
    let settled = false;
    const settle = (p: GpsPermission) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      setGpsPermission(p);
    };
    const timer = setTimeout(() => settle("other"), PERMISSION_TIMEOUT_MS);
    const permissions =
      typeof navigator === "undefined" ? undefined : navigator.permissions;
    if (!permissions?.query) {
      // Không có API (Safari cũ, webview): không biết được thì coi như chưa cấp.
      Promise.resolve().then(() => settle("other"));
    } else {
      permissions.query({ name: "geolocation" }).then(
        (s) => settle(s.state === "granted" ? "granted" : "other"),
        () => settle("other"),
      );
    }
    return () => {
      settled = true;
      clearTimeout(timer);
    };
  }, []);

  const ready = initReady && gpsPermission !== "unknown";
  const gpsPending = loc.status === "asking" || loc.status === "idle";
  const gpsWaiting = gpsPermission === "granted" && gpsPending;

  // Chỉ có vị trí GPS thật (trang này không dùng `setManual`).
  const gps = loc.position;
  const urlCenter = parseUrlCenter(url.lat, url.lng);
  const resolved = resolveCenter({ url: urlCenter, gps, stored });
  const { center, source } = resolved;

  // Nhãn của chỗ vừa tìm, giữ trong phiên: URL chỉ mang toạ độ, mà nhãn tiếng
  // Việt của quần đảo phải hiện đúng như kết quả tìm.
  const [placeLabel, setPlaceLabel] = useState<StoredArea | null>(null);
  let areaLabel: string | null = null;
  if (source === "stored") areaLabel = resolved.label;
  else if (source === "url") {
    if (placeLabel && sameSpot(placeLabel, center))
      areaLabel = placeLabel.label;
    else if (stored && sameSpot(stored, center)) areaLabel = stored.label;
  }

  const radius = url.r;
  const amenities = url.amenities;
  const amenitiesSorted = useMemo(() => [...amenities].sort(), [amenities]);

  const enabled =
    ready && (source === "url" || source === "gps" || !gpsWaiting);
  const query = useQuery({
    queryKey: [
      "venues-near",
      center.lat.toFixed(3),
      center.lng.toFixed(3),
      radius,
      amenitiesSorted,
    ],
    queryFn: async (): Promise<DirectoryVenue[]> => {
      const r = await listVenuesNear({
        lat: center.lat,
        lng: center.lng,
        radiusKm: radius,
        amenities: amenitiesSorted,
      });
      if ("error" in r) throw new Error(r.error);
      return r.venues;
    },
    enabled,
    staleTime: 60_000,
    // Giữ ghim cũ trong lúc tải vùng mới, khỏi nháy trống.
    placeholderData: keepPreviousData,
  });

  const venueIds = useMemo(
    () => (query.data ?? []).map((v) => v.id),
    [query.data],
  );
  // Số buổi theo sân đi qua một lời gọi riêng, như G3.
  const countsQuery = useQuery({
    queryKey: ["venue-exchange-counts", venueIds],
    queryFn: async () => new Map(await loadExchangeCounts!(venueIds)),
    staleTime: 60_000,
    enabled: exchangeEnabled && !!loadExchangeCounts && venueIds.length > 0,
    placeholderData: keepPreviousData,
  });
  const counts = exchangeEnabled ? countsQuery.data : undefined;
  const countsFailed = exchangeEnabled && countsQuery.isError;
  const exchange = exchangeEnabled && url.exchange;
  // Đếm lỗi thì bỏ lọc, hiện đủ danh sách thay vì báo "không có sân".
  const filterOn = exchange && !!loadExchangeCounts && !countsFailed;
  // Vùng mới: số đếm đang giữ là của vùng cũ (placeholder), lọc theo nó thì
  // ra sai, nên coi như đang chờ giống lần đếm đầu.
  const exchangeFilterPending =
    filterOn &&
    venueIds.length > 0 &&
    (countsQuery.isPending || countsQuery.isPlaceholderData);

  // Mốc "đang mở": lấy lúc mở trang, làm mới khi bật/tắt chip. Không hẹn giờ
  // lặp để tự cập nhật (quy tắc không polling).
  const [now, setNow] = useState(() => new Date());
  const openNow = url.open;
  const venues = useMemo<DirectoryVenue[]>(() => {
    if (exchangeFilterPending) return [];
    return filterVenues(query.data ?? [], {
      exchangeOnly: filterOn,
      counts,
      openNow,
      now,
    });
  }, [query.data, exchangeFilterPending, filterOn, counts, openNow, now]);
  const points = useMemo(
    () => venuesToPointsWithExchanges(venues, counts),
    [venues, counts],
  );

  // Dữ liệu thật của vùng hiện tại (không phải placeholder) và bộ lọc đã đủ.
  const settled =
    query.isSuccess && !query.isPlaceholderData && !exchangeFilterPending;
  const venueParam = url.venue;
  const selectedId = venueParam !== null && venueParam > 0 ? venueParam : null;
  const selectedVenue =
    selectedId === null
      ? null
      : (venues.find((v) => v.id === selectedId) ?? null);

  // Mục lịch sử của `?venue=` hiện tại có phải do `select` push trong phiên
  // này không. Back của trình duyệt (hoặc mọi lần ?venue= biến mất) xoá cờ.
  const pushedVenue = useRef(false);
  useEffect(() => {
    if (venueParam === null) pushedVenue.current = false;
  }, [venueParam]);

  const [focus, setFocus] = useState<{
    lat: number;
    lng: number;
    seq: number;
  } | null>(null);
  const [openedFromLink, setOpenedFromLink] = useState(false);
  // Sân của link lúc mở trang, và đã xét nó xong chưa.
  const [linkVenueId] = useState(() =>
    url.venue !== null && url.venue > 0 ? url.venue : null,
  );
  const [linkChecked, setLinkChecked] = useState(false);
  // Đang xem vùng dự phòng trong lúc GPS chưa trả lời: vùng GPS sắp tải có thể
  // chứa sân của link, nên chưa được kết luận là không có. Chờ có hạn vì
  // useUserLocation tự hết giờ về "denied".
  const fallbackAwaitingGps =
    (source === "stored" || source === "default") && gpsPending;
  const linkPending =
    !linkChecked && linkVenueId !== null && selectedId === linkVenueId;
  const holdLink = linkPending && fallbackAwaitingGps;

  // `?venue=` bậy (≤ 0) hoặc không còn trong kết quả đã lọc: bỏ khỏi URL, không
  // đọc thêm DB để tìm sân đó.
  const venueMissing =
    settled && selectedId !== null && !selectedVenue && !holdLink;
  useEffect(() => {
    if (venueParam === null) return;
    if (venueParam > 0 && !venueMissing) return;
    void setUrl({ venue: null });
  }, [venueParam, venueMissing, setUrl]);

  // Link có `?venue=`: xét ở lần dữ liệu thật đầu tiên (hoặc vùng GPS nếu vùng
  // dự phòng không có sân đó). Đặt trong lúc render (cùng kiểu
  // dashboard-client) để khỏi set state trong effect.
  if (!linkChecked && settled) {
    if (linkPending && selectedVenue) {
      setLinkChecked(true);
      setOpenedFromLink(true);
      setFocus((f) => ({
        lat: selectedVenue.lat,
        lng: selectedVenue.lng,
        seq: (f?.seq ?? 0) + 1,
      }));
    } else if (!holdLink) {
      setLinkChecked(true);
    }
  }

  const [mapCenter, setMapCenter] = useState<LatLng | null>(null);
  // Tâm tìm đổi (tìm ở đây, gõ khu vực, GPS về): vị trí kéo cũ hết nghĩa.
  const centerKey = `${center.lat},${center.lng}`;
  const [prevCenterKey, setPrevCenterKey] = useState(centerKey);
  if (centerKey !== prevCenterKey) {
    setPrevCenterKey(centerKey);
    setMapCenter(null);
  }
  const showSearchHere =
    mapCenter !== null &&
    isInVietnamOrIslands(mapCenter) &&
    movedBeyond(mapCenter, center, radius * SEARCH_HERE_RATIO);

  // "Vị trí của tôi": chờ GPS trả lời rồi mới bỏ lat/lng khỏi URL.
  const [locateRequested, setLocateRequested] = useState(false);
  const [locateSeq, setLocateSeq] = useState(0);
  const awaitingFix = useRef(false);
  useEffect(() => {
    if (!awaitingFix.current) return;
    if (loc.status === "ok") {
      awaitingFix.current = false;
      void setUrl({ lat: null, lng: null });
    } else if (loc.status === "denied" || loc.status === "unsupported") {
      awaitingFix.current = false;
    }
  }, [loc.status, locateSeq, setUrl]);
  const locating = locateRequested && loc.status === "asking";
  const locateFailed =
    locateRequested &&
    (loc.status === "denied" || loc.status === "unsupported");

  // Hàm thường, không useCallback: MapView đọc callback qua ref mới nhất nên
  // đổi identity không dựng lại bản đồ, và React Compiler tự memo khi được.
  function setRadius(r: VenueRadius) {
    // Bản đồ về lại tâm tìm, nên nút "Tìm ở khu vực này" cũ phải ẩn.
    setMapCenter(null);
    void setUrl({ r });
  }
  function setAmenities(next: VenueAmenity[]) {
    void setUrl({ amenities: next.length > 0 ? next : null });
  }
  function setExchange(on: boolean) {
    void setUrl({ exchange: on ? true : null });
  }
  function setOpenNow(on: boolean) {
    setNow(new Date());
    void setUrl({ open: on ? true : null });
  }

  function select(id: number) {
    // Back trên điện thoại đóng thẻ xem nhanh, nên lần chọn đầu ghi bằng push.
    // Đang mở một sân mà bấm sân khác thì thay mục đó, để mỗi thẻ xem nhanh chỉ
    // có đúng một mục lịch sử.
    const push = !pushedVenue.current;
    pushedVenue.current = true;
    void setUrl({ venue: id }, { history: push ? "push" : "replace" });
    const v = venues.find((x) => x.id === id);
    if (v) {
      setFocus((f) => ({ lat: v.lat, lng: v.lng, seq: (f?.seq ?? 0) + 1 }));
    }
  }
  function clearSelection() {
    // Mục `?venue=` do chính trang này push: lùi qua nó, đừng xoá bằng replace
    // (để lại mục thừa khiến Back phải bấm hai lần mới rời trang). Sân mở từ
    // link chia sẻ không có mục của mình nên vẫn xoá bằng replace.
    if (pushedVenue.current && typeof window !== "undefined") {
      pushedVenue.current = false;
      window.history.back();
      return;
    }
    void setUrl({ venue: null });
  }

  function onMoveEnd(c: LatLng) {
    // Chỉ ghi nhớ, không gọi server (quy tắc quota).
    setMapCenter(c);
  }

  function goTo(p: LatLng, label: string) {
    const area = { lat: roundCoord(p.lat), lng: roundCoord(p.lng), label };
    // Người dùng đã chọn chỗ khác: GPS của lần "Vị trí của tôi" đang chờ
    // không được kéo màn về vị trí máy nữa.
    awaitingFix.current = false;
    setLocateRequested(false);
    setPlaceLabel(area);
    setStored(area);
    writeStoredArea(area);
    // Mục đã push giờ mang vùng mới (replace), không còn là mục của thẻ xem
    // nhanh nữa.
    pushedVenue.current = false;
    void setUrl({ lat: area.lat, lng: area.lng, venue: null });
  }
  function searchHere() {
    if (!mapCenter) return;
    goTo(mapCenter, t("selectedArea"));
  }
  function placeSearched(p: LatLng, label: string) {
    setMapCenter(null);
    goTo(p, label);
  }
  function locate() {
    awaitingFix.current = true;
    setLocateRequested(true);
    setLocateSeq((s) => s + 1);
    request();
  }

  function retryCounts() {
    void countsQuery.refetch();
  }

  return {
    center,
    source,
    areaLabel,
    ready,
    gpsWaiting,
    radius,
    setRadius,
    amenities,
    setAmenities,
    exchange,
    setExchange,
    openNow,
    setOpenNow,
    /** Mốc giờ dùng cho chip "Đang mở"; thẻ sân nên dùng cùng mốc để khớp. */
    now,
    query,
    venues,
    points,
    counts,
    countsFailed,
    exchangeFilterPending,
    retryCounts,
    selectedId,
    selectedVenue,
    select,
    clearSelection,
    focus,
    openedFromLink,
    onMoveEnd,
    showSearchHere,
    searchHere,
    placeSearched,
    locate,
    locating,
    locateFailed,
    gps,
  };
}

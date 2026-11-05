"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MapPinOff } from "lucide-react";
import {
  MapLibreMap,
  Marker,
  setWorkerUrl,
  type GeoJSONSource,
} from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import type { LatLng } from "@/lib/geo";
import {
  MAP_STYLE_URL,
  pointKey,
  radiusCircle,
  zoomForRadiusKm,
  type MapPoint,
} from "@/lib/map/map-points";
import {
  applyVietnamSovereignty,
  VN_ISLANDS_LAYER_ID,
} from "@/lib/map/sovereignty";
import { cssColor } from "@/lib/map/style-helpers";
import { hasWebGL2 } from "@/lib/map/webgl";
import { cn } from "@/lib/utils";

export type MapViewProps = {
  points: MapPoint[];
  center: LatLng;
  radiusKm?: number;
  /** Zoom lúc tạo map; bỏ trống thì suy ra từ `radiusKm`. */
  zoom?: number;
  userPosition?: LatLng | null;
  /** Chỉ chọn được ghim `kind: "venue"` có id này (đường cũ của /san). */
  selectedId?: number | null;
  /**
   * Chọn theo `pointKey`. Có prop này (kể cả null) thì nó thắng `selectedId`,
   * vì id sân và id buổi/ghim giao lưu có thể trùng nhau.
   */
  selectedKey?: string | null;
  onPointClick?: (p: MapPoint) => void;
  /** Chỉ gọi khi NGƯỜI DÙNG kéo/zoom, không gọi khi code đổi tâm. */
  onMoveEnd?: (center: LatLng) => void;
  /** `false`: tắt mọi thao tác kéo/zoom (bản đồ nhỏ không cướp cuộn trang). */
  interactive?: boolean;
  /**
   * Điện thoại: một ngón cuộn trang, hai ngón mới kéo bản đồ. Chỉ bật cho
   * bản đồ chiếm gần cả màn hình (danh bạ sân); bản đồ chọn vị trí và bản đồ
   * nhỏ không cần.
   */
  cooperativeGestures?: boolean;
  className?: string;
  onUnsupported?: () => void;
};

// maplibre tự suy URL worker từ import.meta.url của nó, nhưng dưới Turbopack
// giá trị đó không phải http(s) nên nó tạo worker bằng chính URL trang ("Worker
// failed to load", nền bản đồ trống). Mẫu `new URL(..., import.meta.url)` để
// bundler phát file worker thành asset cùng origin, khớp đúng bản đã cài.
// Đặt một lần khi module nạp, trước khi tạo bất kỳ map nào.
setWorkerUrl(
  new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href,
);

const DEFAULT_RADIUS_KM = 5;
const STYLE_TIMEOUT_MS = 10_000;

const RADIUS_SOURCE = "app-radius";
const RADIUS_FILL_LAYER = "app-radius-fill";
const RADIUS_LINE_LAYER = "app-radius-line";

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

type Translate = (key: string) => string;

function mapUiStrings(t: Translate): Record<string, string> {
  return {
    "CooperativeGesturesHandler.WindowsHelpText": t("mapGestureWindows"),
    "CooperativeGesturesHandler.MacHelpText": t("mapGestureMac"),
    "CooperativeGesturesHandler.MobileHelpText": t("mapGestureMobile"),
    "AttributionControl.ToggleAttribution": t("mapAttributionToggle"),
    "AttributionControl.MapFeedback": t("mapFeedback"),
  };
}

function radiusData(center: LatLng, km: number | undefined): FeatureCollection {
  if (km === undefined) return EMPTY;
  return { type: "FeatureCollection", features: [radiusCircle(center, km)] };
}

// Biểu tượng ghim (lucide map-pin). Chuỗi tĩnh, không chứa dữ liệu người
// dùng; tên sân chỉ đi qua setAttribute.
const PIN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" class="size-8 fill-primary stroke-background drop-shadow-md" stroke-width="1.5" stroke-linejoin="round"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3" class="fill-background stroke-none"/></svg>';

type PinEntry = { point: MapPoint; el: HTMLButtonElement; marker: Marker };

function createPin(onClick: () => void): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className =
    "group relative flex size-11 cursor-pointer items-end justify-center rounded-full pb-0.5 focus-visible:outline-2 focus-visible:outline-ring data-[selected=true]:z-10";
  // maplibre ghi `transform` của chính phần tử marker mỗi khung hình để bám
  // toạ độ, nên hiệu ứng phóng to nằm ở span con, không ở nút.
  el.innerHTML = `<span class="origin-bottom transition-[scale] duration-200 group-data-[selected=true]:scale-125">${PIN_SVG}</span>`;
  const badge = document.createElement("span");
  badge.dataset.role = "count";
  badge.hidden = true;
  badge.setAttribute("aria-hidden", "true");
  badge.className =
    "bg-background text-foreground border-primary pointer-events-none absolute top-0 right-0 flex size-5 items-center justify-center rounded-full border text-sm leading-none font-bold";
  el.appendChild(badge);
  el.addEventListener("click", (e) => {
    // Không để cú bấm ghim lọt xuống bản đồ.
    e.stopPropagation();
    onClick();
  });
  return el;
}

function createUserDot(): HTMLDivElement {
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.className = "relative flex size-5 items-center justify-center";
  el.innerHTML =
    '<span class="absolute inline-flex size-full animate-ping rounded-full bg-primary/40"></span><span class="relative size-3.5 rounded-full border-2 border-background bg-primary shadow"></span>';
  return el;
}

/**
 * Vòng bán kính, layer duy nhất của app. Gắn lại mỗi lần style nạp vì đổi
 * style là mất hết layer cũ. Nằm dưới nhãn chủ quyền. Ghim sân KHÔNG ở đây:
 * chúng là marker HTML để vẫn hiện (và bấm được bằng bàn phím, trình đọc màn
 * hình) khi style nền không tải được.
 */
function addRadiusRing(map: MapLibreMap, center: LatLng, km?: number) {
  const primary = cssColor(map.getContainer(), "--primary");
  const before = map.getLayer(VN_ISLANDS_LAYER_ID)
    ? VN_ISLANDS_LAYER_ID
    : undefined;
  map.addSource(RADIUS_SOURCE, {
    type: "geojson",
    data: radiusData(center, km),
  });
  map.addLayer(
    {
      id: RADIUS_FILL_LAYER,
      type: "fill",
      source: RADIUS_SOURCE,
      paint: {
        "fill-opacity": 0.08,
        ...(primary ? { "fill-color": primary } : {}),
      },
    },
    before,
  );
  map.addLayer(
    {
      id: RADIUS_LINE_LAYER,
      type: "line",
      source: RADIUS_SOURCE,
      paint: {
        "line-width": 2,
        "line-opacity": 0.6,
        ...(primary ? { "line-color": primary } : {}),
      },
    },
    before,
  );
}

/**
 * Bản đồ dùng chung cho mọi màn (danh bạ sân, bản đồ nhỏ, chọn vị trí).
 * Tự áp lớp chủ quyền Hoàng Sa/Trường Sa. Không gọi server: kéo/zoom chỉ báo
 * `onMoveEnd`, việc tải lại là của màn cha. Nạp qua `LazyMapView` để
 * `maplibre-gl` không vào bundle của trang khi chưa cần.
 */
export function MapView({
  points,
  center,
  radiusKm,
  zoom,
  userPosition = null,
  selectedId = null,
  selectedKey,
  onPointClick,
  onMoveEnd,
  interactive = true,
  cooperativeGestures = false,
  className,
  onUnsupported,
}: MapViewProps) {
  const t = useTranslations("venues");
  const tx = useTranslations("exchange.search");
  const locale = useLocale();
  // Component chỉ chạy phía client (LazyMapView tắt SSR) nên kiểm ngay lúc
  // render đầu, không chớp khung bản đồ trắng trước khi hiện thông báo.
  const [unsupported, setUnsupported] = useState(() => !hasWebGL2());
  const [styleFailed, setStyleFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef(new Map<string, PinEntry>());
  const userMarkerRef = useRef<Marker | null>(null);
  const lastViewRef = useRef({ lat: center.lat, lng: center.lng, radiusKm });

  // Handler của maplibre đăng ký một lần lúc tạo map, nên đọc props mới
  // nhất qua ref thay vì closure cũ.
  const latest = useRef({
    points,
    center,
    radiusKm,
    zoom,
    selectedId,
    interactive,
    cooperativeGestures,
    locale,
    t,
    onPointClick,
    onMoveEnd,
    onUnsupported,
  });
  useEffect(() => {
    latest.current = {
      points,
      center,
      radiusKm,
      zoom,
      selectedId,
      interactive,
      cooperativeGestures,
      locale,
      t,
      onPointClick,
      onMoveEnd,
      onUnsupported,
    };
  });

  useEffect(() => {
    if (unsupported) latest.current.onUnsupported?.();
  }, [unsupported]);

  // `cooperativeGestures` chỉ được đọc lúc tạo map. Cha (useIsMobile) có thể
  // đổi giá trị ngay sau khi map đã tạo, nên áp lại ở đây.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (cooperativeGestures) map.cooperativeGestures.enable();
    else map.cooperativeGestures.disable();
  }, [cooperativeGestures, unsupported]);

  useEffect(() => {
    const container = containerRef.current;
    if (unsupported || !container) return;
    const init = latest.current;
    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container,
        style: MAP_STYLE_URL,
        center: [init.center.lng, init.center.lat],
        zoom: init.zoom ?? zoomForRadiusKm(init.radiusKm ?? DEFAULT_RADIUS_KM),
        interactive: init.interactive,
        cooperativeGestures: init.cooperativeGestures,
        // Chuỗi giao diện mặc định của maplibre là tiếng Anh.
        locale: mapUiStrings(init.t),
        attributionControl: { compact: true },
      });
    } catch {
      // Máy báo có WebGL2 nhưng tạo context vẫn hỏng (GPUInitializationError).
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the map constructor is the external system; its failure is only known here.
      setUnsupported(true);
      return;
    }
    mapRef.current = map;
    const markers = markersRef.current;

    // Lỗi trước lần nạp style đầu (mất mạng tới openfreemap): nền trống nhưng
    // ghim HTML vẫn hiện, báo người dùng bằng lớp phủ. Lỗi tile lẻ về sau thì
    // bỏ qua, vì nền đã có và maplibre tự thử lại.
    let styleLoaded = false;
    map.on("error", () => {
      if (!styleLoaded) setStyleFailed(true);
    });
    // Trình duyệt nhúng hạn chế có thể treo request thay vì báo lỗi: không có
    // sự kiện nào, bản đồ xám mãi. Quá hạn thì báo như lỗi style.
    const styleTimer = setTimeout(() => {
      if (!styleLoaded) setStyleFailed(true);
    }, STYLE_TIMEOUT_MS);
    map.on("style.load", () => {
      styleLoaded = true;
      clearTimeout(styleTimer);
      setStyleFailed(false);
      const s = latest.current;
      applyVietnamSovereignty(map, s.locale);
      try {
        addRadiusRing(map, s.center, s.radiusKm);
      } catch {
        // Chỉ mất vòng bán kính; bản đồ và ghim vẫn dùng được.
      }
    });
    map.on("moveend", (e) => {
      // Có originalEvent mới là người dùng kéo/zoom; easeTo/jumpTo của code
      // thì không có.
      if (!e.originalEvent) return;
      const c = map.getCenter();
      latest.current.onMoveEnd?.({ lat: c.lat, lng: c.lng });
    });

    return () => {
      clearTimeout(styleTimer);
      for (const entry of markers.values()) entry.marker.remove();
      markers.clear();
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [unsupported]);

  // Đổi điểm hoặc sân đang chọn: cập nhật ghim tại chỗ, không tạo lại map.
  // Mọi sân luôn là nút HTML, không gom cụm: listVenuesNear trả tối đa 50
  // sân, và ghim phải hiện cả khi style nền không tải được.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = markersRef.current;
    const keep = new Set(points.map(pointKey));
    for (const [id, entry] of markers) {
      if (!keep.has(id)) {
        entry.marker.remove();
        markers.delete(id);
      }
    }
    for (const p of points) {
      const key = pointKey(p);
      let entry = markers.get(key);
      if (!entry) {
        const el = createPin(() => {
          const current = markers.get(key)?.point;
          if (current) latest.current.onPointClick?.(current);
        });
        const marker = new Marker({ element: el, anchor: "bottom" })
          .setLngLat([p.lng, p.lat])
          .addTo(map);
        entry = { point: p, el, marker };
        markers.set(key, entry);
      }
      entry.point = p;
      entry.marker.setLngLat([p.lng, p.lat]);
      const count = p.kind === "exchange" ? p.count : 1;
      entry.el.setAttribute(
        "aria-label",
        p.kind === "exchange" && count > 1
          ? tx("pinLabel", { label: p.label, count })
          : p.label,
      );
      const badge = entry.el.querySelector<HTMLElement>("[data-role=count]");
      if (badge) {
        badge.hidden = count <= 1;
        badge.textContent = count > 1 ? String(count) : "";
      }
      const selected =
        selectedKey !== undefined
          ? key === selectedKey
          : p.kind === "venue" && p.id === selectedId;
      entry.el.dataset.selected = String(selected);
      // Bản đồ không tương tác (bản đồ nhỏ): ghim chỉ để nhìn. Bỏ khỏi thứ
      // tự Tab/trình đọc màn hình và nhường cú chạm cho lớp phủ của màn cha.
      entry.el.tabIndex = interactive ? 0 : -1;
      entry.el.classList.toggle("pointer-events-none", !interactive);
      if (interactive) entry.el.removeAttribute("aria-hidden");
      else entry.el.setAttribute("aria-hidden", "true");
    }
  }, [points, selectedId, selectedKey, unsupported, interactive, tx]);

  // Màn cha đổi tâm/bán kính (vd "Tìm ở khu vực này", đổi bán kính).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const prev = lastViewRef.current;
    if (
      prev.lat === center.lat &&
      prev.lng === center.lng &&
      prev.radiusKm === radiusKm
    ) {
      return;
    }
    lastViewRef.current = { lat: center.lat, lng: center.lng, radiusKm };
    const c = { lat: center.lat, lng: center.lng };
    map
      .getSource<GeoJSONSource>(RADIUS_SOURCE)
      ?.setData(radiusData(c, radiusKm));
    map.easeTo({
      center: [c.lng, c.lat],
      zoom: zoomForRadiusKm(radiusKm ?? DEFAULT_RADIUS_KM),
    });
  }, [center.lat, center.lng, radiusKm]);

  const userLat = userPosition?.lat;
  const userLng = userPosition?.lng;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (userLat === undefined || userLng === undefined) {
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      return;
    }
    if (userMarkerRef.current) {
      userMarkerRef.current.setLngLat([userLng, userLat]);
    } else {
      userMarkerRef.current = new Marker({ element: createUserDot() })
        .setLngLat([userLng, userLat])
        .addTo(map);
    }
  }, [userLat, userLng, unsupported]);

  const box = cn(
    "relative h-[60dvh] w-full overflow-hidden rounded-2xl border bg-muted/40",
    className,
  );

  if (unsupported) {
    return (
      <div
        role="status"
        className={cn(
          box,
          "bg-card/80 flex flex-col items-center justify-center gap-3 p-6 text-center backdrop-blur",
        )}
      >
        <MapPinOff className="text-muted-foreground size-8" aria-hidden />
        <p className="text-base">{t("mapUnsupported")}</p>
      </div>
    );
  }

  return (
    <div className={box}>
      {/* maplibre gắn `.maplibregl-map { position: relative }` lên chính
          container; ở bản build production rule đó thắng `absolute` nên khung
          cao 0. Lớp ngoài lo định vị, container chỉ lấp đầy nó. */}
      <div className="absolute inset-0">
        <div ref={containerRef} className="h-full w-full" />
      </div>
      {styleFailed && (
        <div
          role="status"
          className="bg-card/80 pointer-events-none absolute inset-x-3 top-16 z-10 flex items-center gap-2 rounded-xl border p-3 text-sm backdrop-blur"
        >
          <MapPinOff
            className="text-muted-foreground size-5 shrink-0"
            aria-hidden
          />
          <p>{t("mapTilesFailed")}</p>
        </div>
      )}
    </div>
  );
}

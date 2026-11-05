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
  radiusCircle,
  zoomForRadiusKm,
  type MapPoint,
} from "@/lib/map/map-points";
import {
  applyVietnamSovereignty,
  VN_ISLANDS_LAYER_ID,
} from "@/lib/map/sovereignty";
import { cssColor } from "@/lib/map/style-helpers";
import { cn } from "@/lib/utils";

export type MapViewProps = {
  points: MapPoint[];
  center: LatLng;
  radiusKm?: number;
  userPosition?: LatLng | null;
  selectedId?: number | null;
  onPointClick?: (p: MapPoint) => void;
  /** Chỉ gọi khi NGƯỜI DÙNG kéo/zoom, không gọi khi code đổi tâm. */
  onMoveEnd?: (center: LatLng) => void;
  /** `false`: tắt mọi thao tác kéo/zoom (bản đồ nhỏ không cướp cuộn trang). */
  interactive?: boolean;
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

const RADIUS_SOURCE = "app-radius";
const RADIUS_FILL_LAYER = "app-radius-fill";
const RADIUS_LINE_LAYER = "app-radius-line";

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

/** maplibre-gl v6 chỉ chạy trên WebGL2. */
function hasWebGL2(): boolean {
  if (typeof document === "undefined") return true;
  try {
    return document.createElement("canvas").getContext("webgl2") !== null;
  } catch {
    return false;
  }
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
    "flex size-11 cursor-pointer items-end justify-center rounded-full pb-0.5 transition-transform duration-200 focus-visible:outline-2 focus-visible:outline-ring data-[selected=true]:z-10 data-[selected=true]:scale-125";
  el.innerHTML = PIN_SVG;
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
  userPosition = null,
  selectedId = null,
  onPointClick,
  onMoveEnd,
  interactive = true,
  className,
  onUnsupported,
}: MapViewProps) {
  const t = useTranslations("venues");
  const locale = useLocale();
  // Component chỉ chạy phía client (LazyMapView tắt SSR) nên kiểm ngay lúc
  // render đầu, không chớp khung bản đồ trắng trước khi hiện thông báo.
  const [unsupported, setUnsupported] = useState(() => !hasWebGL2());
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef(new Map<number, PinEntry>());
  const userMarkerRef = useRef<Marker | null>(null);
  const lastViewRef = useRef({ lat: center.lat, lng: center.lng, radiusKm });

  // Handler của maplibre đăng ký một lần lúc tạo map, nên đọc props mới
  // nhất qua ref thay vì closure cũ.
  const latest = useRef({
    points,
    center,
    radiusKm,
    selectedId,
    interactive,
    locale,
    onPointClick,
    onMoveEnd,
    onUnsupported,
  });
  useEffect(() => {
    latest.current = {
      points,
      center,
      radiusKm,
      selectedId,
      interactive,
      locale,
      onPointClick,
      onMoveEnd,
      onUnsupported,
    };
  });

  useEffect(() => {
    if (unsupported) latest.current.onUnsupported?.();
  }, [unsupported]);

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
        zoom: zoomForRadiusKm(init.radiusKm ?? DEFAULT_RADIUS_KM),
        interactive: init.interactive,
        attributionControl: { compact: true },
      });
    } catch {
      // Máy báo có WebGL2 nhưng tạo context vẫn hỏng (GPUInitializationError).
      console.warn("[Map] webgl_unavailable");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the map constructor is the external system; its failure is only known here.
      setUnsupported(true);
      return;
    }
    mapRef.current = map;
    const markers = markersRef.current;

    // Mất mạng tới openfreemap: nền trống nhưng ghim HTML vẫn hiện. Chỉ log.
    map.on("error", (e) => {
      console.warn("[Map] style_error", e.error?.message);
    });
    map.on("style.load", () => {
      const s = latest.current;
      applyVietnamSovereignty(map, s.locale);
      try {
        addRadiusRing(map, s.center, s.radiusKm);
      } catch {
        console.warn("[Map] radius_error");
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
    const keep = new Set(points.map((p) => p.id));
    for (const [id, entry] of markers) {
      if (!keep.has(id)) {
        entry.marker.remove();
        markers.delete(id);
      }
    }
    for (const p of points) {
      let entry = markers.get(p.id);
      if (!entry) {
        const el = createPin(() => {
          const current = markers.get(p.id)?.point;
          if (current) latest.current.onPointClick?.(current);
        });
        const marker = new Marker({ element: el, anchor: "bottom" })
          .setLngLat([p.lng, p.lat])
          .addTo(map);
        entry = { point: p, el, marker };
        markers.set(p.id, entry);
      }
      entry.point = p;
      entry.marker.setLngLat([p.lng, p.lat]);
      entry.el.setAttribute("aria-label", p.label);
      entry.el.dataset.selected = String(p.id === selectedId);
      // Bản đồ không tương tác (bản đồ nhỏ): ghim chỉ để nhìn. Bỏ khỏi thứ
      // tự Tab/trình đọc màn hình và nhường cú chạm cho lớp phủ của màn cha.
      entry.el.tabIndex = interactive ? 0 : -1;
      entry.el.classList.toggle("pointer-events-none", !interactive);
      if (interactive) entry.el.removeAttribute("aria-hidden");
      else entry.el.setAttribute("aria-hidden", "true");
    }
  }, [points, selectedId, unsupported, interactive]);

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
    </div>
  );
}

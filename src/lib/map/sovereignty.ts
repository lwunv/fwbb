import type { FeatureCollection, MultiPolygon, Point, Position } from "geojson";
import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  Map as MapLibreMap,
} from "maplibre-gl";
import { cssColor, styleFont } from "./style-helpers";

/*
 * Chủ quyền Việt Nam trên mọi bản đồ của app (spec G3 mục 7, user yêu cầu
 * 4/11/2026). Bản đồ nền OSM có thể ghi tên nước ngoài cho hai quần đảo và
 * vẽ đường biên tranh chấp, nên app tự che nhãn nền trong hai vùng đó và đặt
 * nhãn của mình lên trên.
 */

type MapLocale = "vi" | "en" | "zh";

export const VN_ISLAND_LABELS = [
  {
    id: "hoang-sa",
    lat: 16.5,
    lng: 112.0,
    name: {
      vi: "Quần đảo Hoàng Sa (Việt Nam)",
      en: "Hoang Sa Archipelago (Viet Nam)",
      zh: "黄沙群岛（越南）",
    },
  },
  {
    id: "truong-sa",
    lat: 10.0,
    lng: 114.0,
    name: {
      vi: "Quần đảo Trường Sa (Việt Nam)",
      en: "Truong Sa Archipelago (Viet Nam)",
      zh: "长沙群岛（越南）",
    },
  },
] as const;

/** Hình chữ nhật khép kín [tây, nam, đông, bắc] dạng vòng GeoJSON. */
function box(west: number, south: number, east: number, north: number) {
  const ring: Position[] = [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
  return [ring];
}

/** Vùng bao Hoàng Sa và Trường Sa: nhãn nền nằm trong đây bị ẩn. */
export const VN_ISLAND_AREAS: MultiPolygon = {
  type: "MultiPolygon",
  coordinates: [box(110.9, 15.6, 113.0, 17.3), box(111.4, 6.8, 117.9, 12.2)],
};

export const VN_ISLANDS_LAYER_ID = "vn-islands";

/** Nguồn dữ liệu (OpenMapTiles) của nhãn địa danh: đổi sang tên tiếng Việt. */
const PLACE_SOURCE_LAYERS = new Set(["place", "water_name"]);

const OUTSIDE_VN_ISLANDS: ExpressionSpecification = [
  "!",
  ["within", VN_ISLAND_AREAS],
];
const NOT_DISPUTED: ExpressionSpecification = ["!=", ["get", "disputed"], 1];
const NOT_MARITIME: ExpressionSpecification = ["!=", ["get", "maritime"], 1];
const VI_NAME: ExpressionSpecification = [
  "coalesce",
  ["get", "name:vi"],
  ["get", "name"],
];

type SovereigntyMap = Pick<
  MapLibreMap,
  | "getStyle"
  | "setFilter"
  | "setLayoutProperty"
  | "addSource"
  | "addLayer"
  | "getLayer"
  | "getContainer"
>;

function toLocale(locale: string): MapLocale {
  return locale === "en" || locale === "zh" ? locale : "vi";
}

function islandLabelData(locale: string): FeatureCollection<Point> {
  const key = toLocale(locale);
  return {
    type: "FeatureCollection",
    features: VN_ISLAND_LABELS.map((l) => ({
      type: "Feature",
      properties: { label: l.name[key] },
      geometry: { type: "Point", coordinates: [l.lng, l.lat] },
    })),
  };
}

/**
 * Filter kiểu cũ (`["==", "class", "city"]`) không gộp được với biểu thức
 * `within`: maplibre coi cả cụm là kiểu cũ rồi từ chối. Cùng luật nhận diện
 * với `isExpressionFilter` của maplibre-gl-style-spec.
 */
function isExpressionFilter(filter: unknown): boolean {
  if (typeof filter === "boolean") return true;
  if (!Array.isArray(filter) || filter.length === 0) return false;
  switch (filter[0]) {
    case "has":
      return filter.length >= 2 && filter[1] !== "$id" && filter[1] !== "$type";
    case "in":
      return (
        filter.length >= 3 &&
        (typeof filter[1] !== "string" || Array.isArray(filter[2]))
      );
    case "!in":
    case "!has":
    case "none":
      return false;
    case "==":
    case "!=":
    case ">":
    case ">=":
    case "<":
    case "<=":
      return (
        filter.length !== 3 ||
        Array.isArray(filter[1]) ||
        Array.isArray(filter[2])
      );
    case "any":
    case "all":
      return filter.slice(1).every(isExpressionFilter);
    default:
      return true;
  }
}

/** Thêm điều kiện vào filter sẵn có của layer nền (giữ filter cũ). */
function addConditions(
  map: SovereigntyMap,
  layer: LayerSpecification,
  conditions: ExpressionSpecification[],
) {
  const old: FilterSpecification | undefined =
    "filter" in layer ? layer.filter : undefined;
  if (old === undefined) {
    map.setFilter(layer.id, ["all", ...conditions]);
  } else if (isExpressionFilter(old)) {
    map.setFilter(layer.id, [
      "all",
      old as ExpressionSpecification,
      ...conditions,
    ]);
  } else {
    // Không gộp được thì ẩn cả layer: thà thiếu vài nhãn còn hơn để lọt
    // tên nước ngoài hay đường biên tranh chấp.
    map.setLayoutProperty(layer.id, "visibility", "none");
  }
}

function patchBaseLayer(
  map: SovereigntyMap,
  layer: LayerSpecification,
  locale: string,
) {
  const sourceLayer =
    "source-layer" in layer ? layer["source-layer"] : undefined;
  if (layer.type === "symbol") {
    addConditions(map, layer, [OUTSIDE_VN_ISLANDS]);
    if (
      toLocale(locale) === "vi" &&
      sourceLayer !== undefined &&
      PLACE_SOURCE_LAYERS.has(sourceLayer) &&
      layer.layout?.["text-field"] !== undefined
    ) {
      map.setLayoutProperty(layer.id, "text-field", VI_NAME);
    }
  }
  if (sourceLayer === "boundary") {
    addConditions(map, layer, [NOT_DISPUTED, NOT_MARITIME]);
  }
}

function addIslandLabels(
  map: SovereigntyMap,
  baseLayers: LayerSpecification[],
  locale: string,
) {
  const el = map.getContainer();
  const textColor = cssColor(el, "--foreground");
  const haloColor = cssColor(el, "--background");
  map.addSource(VN_ISLANDS_LAYER_ID, {
    type: "geojson",
    data: islandLabelData(locale),
  });
  map.addLayer({
    id: VN_ISLANDS_LAYER_ID,
    type: "symbol",
    source: VN_ISLANDS_LAYER_ID,
    minzoom: 3,
    layout: {
      "text-field": ["get", "label"],
      "text-font": styleFont(baseLayers, "Italic"),
      "text-size": 13,
      "text-max-width": 8,
      // Luôn hiện, không bị nhãn khác chen mất chỗ.
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      ...(textColor ? { "text-color": textColor } : {}),
      ...(haloColor
        ? { "text-halo-color": haloColor, "text-halo-width": 1.5 }
        : {}),
    },
  });
}

/**
 * Áp chủ quyền lên style vừa nạp xong: nhãn "Quần đảo Hoàng Sa/Trường Sa
 * (Việt Nam)" trên cùng, che nhãn nền trong hai vùng, ẩn đường biên tranh
 * chấp và trên biển, ưu tiên tên tiếng Việt khi người xem dùng tiếng Việt.
 * Gọi lại mỗi lần style nạp lại (`style.load`). Không bao giờ ném lỗi: bản
 * đồ vẫn phải dùng được, chỉ log mã.
 */
export function applyVietnamSovereignty(
  map: SovereigntyMap,
  locale: string,
): void {
  let failed = false;
  try {
    if (map.getLayer(VN_ISLANDS_LAYER_ID)) return;
    const baseLayers = map.getStyle().layers;
    // Thêm nhãn trước tiên để nó không phụ thuộc phần lọc bên dưới. Nó là
    // layer cuối cùng nên nằm trên mọi layer nền.
    try {
      addIslandLabels(map, baseLayers, locale);
    } catch {
      failed = true;
    }
    for (const layer of baseLayers) {
      try {
        patchBaseLayer(map, layer, locale);
      } catch {
        failed = true;
      }
    }
  } catch {
    failed = true;
  }
  if (failed) console.warn("[Map] sovereignty_error");
}

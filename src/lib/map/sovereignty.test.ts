import { describe, it, expect, vi, afterEach } from "vitest";
import {
  applyVietnamSovereignty,
  EAST_SEA_LABEL,
  EAST_SEA_LAYER_ID,
  VN_ISLAND_AREAS,
  VN_ISLAND_LABELS,
  VN_ISLANDS_LAYER_ID,
} from "./sovereignty";

type SovereigntyMap = Parameters<typeof applyVietnamSovereignty>[0];

/** Map giả: 2 layer chữ (địa danh + đường) và 1 layer biên giới. */
function fakeMap(layers?: unknown[]) {
  const added = new Set<string>();
  const filters = new Map<string, unknown>();
  const map = {
    getStyle: vi.fn(() => ({
      version: 8,
      sources: {},
      layers: layers ?? [
        {
          id: "label_city",
          type: "symbol",
          source: "openmaptiles",
          "source-layer": "place",
          filter: ["==", ["get", "class"], "city"],
          layout: {
            "text-field": ["get", "name_en"],
            "text-font": ["Noto Sans Regular"],
          },
        },
        {
          id: "highway-name-major",
          type: "symbol",
          source: "openmaptiles",
          "source-layer": "transportation_name",
          layout: {
            "text-field": ["get", "name"],
            "text-font": ["Noto Sans Italic"],
          },
        },
        {
          id: "boundary_2",
          type: "line",
          source: "openmaptiles",
          "source-layer": "boundary",
          filter: ["==", ["get", "admin_level"], 2],
        },
      ],
    })),
    setFilter: vi.fn((id: string, f: unknown) => {
      filters.set(id, f);
    }),
    getFilter: vi.fn((id: string) => filters.get(id)),
    setLayoutProperty: vi.fn(),
    addSource: vi.fn(),
    addLayer: vi.fn((l: { id: string }) => added.add(l.id)),
    getLayer: vi.fn((id: string) => (added.has(id) ? { id } : undefined)),
    moveLayer: vi.fn(),
    getContainer: vi.fn(() => null),
  };
  return map;
}

const asMap = (m: ReturnType<typeof fakeMap>) => m as unknown as SovereigntyMap;

function filterOf(m: ReturnType<typeof fakeMap>, id: string): string {
  const call = m.setFilter.mock.calls.find((c) => c[0] === id);
  return JSON.stringify(call?.[1]);
}

function labelsAddedFor(locale: string): string[] {
  const m = fakeMap();
  applyVietnamSovereignty(asMap(m), locale);
  const src = m.addSource.mock.calls.find((c) => c[0] === VN_ISLANDS_LAYER_ID);
  const data = (
    src?.[1] as {
      data: { features: { properties: { label: string } }[] };
    }
  ).data;
  return data.features.map((f) => f.properties.label);
}

afterEach(() => vi.restoreAllMocks());

describe("applyVietnamSovereignty", () => {
  it("sovereignty: adds the vn-islands layer with Vietnamese names and filters base labels inside both island areas", () => {
    const m = fakeMap();
    applyVietnamSovereignty(asMap(m), "vi");

    const layer = m.addLayer.mock.calls.find(
      (c) => (c[0] as { id: string }).id === VN_ISLANDS_LAYER_ID,
    )?.[0] as unknown as {
      type: string;
      minzoom: number;
      layout: Record<string, unknown>;
    };
    expect(layer.type).toBe("symbol");
    expect(layer.minzoom).toBe(3);
    // Chữ nghiêng lấy đúng font nghiêng mà style nền đang có.
    expect(layer.layout["text-font"]).toEqual(["Noto Sans Italic"]);

    // Cả 2 layer chữ của nền bị lọc bỏ phần nằm trong 2 vùng quần đảo,
    // giữ nguyên filter cũ.
    const areas = JSON.stringify(VN_ISLAND_AREAS);
    for (const id of ["label_city", "highway-name-major"]) {
      const f = filterOf(m, id);
      expect(f).toContain('"within"');
      expect(f).toContain(areas);
    }
    expect(filterOf(m, "label_city")).toContain(
      JSON.stringify(["==", ["get", "class"], "city"]),
    );

    expect(labelsAddedFor("vi")).toEqual([
      "Quần đảo Hoàng Sa (Việt Nam)",
      "Quần đảo Trường Sa (Việt Nam)",
    ]);
    expect(labelsAddedFor("en")).toEqual([
      "Hoang Sa Archipelago (Viet Nam)",
      "Truong Sa Archipelago (Viet Nam)",
    ]);
    expect(labelsAddedFor("zh")).toEqual([
      "黄沙群岛（越南）",
      "长沙群岛（越南）",
    ]);

    const everything = JSON.stringify([VN_ISLAND_LABELS, VN_ISLAND_AREAS]);
    for (const banned of ["Paracel", "Spratly", "西沙", "南沙"]) {
      expect(everything).not.toContain(banned);
    }
  });

  it("the two areas cover Hoang Sa and Truong Sa as the spec states", () => {
    expect(VN_ISLAND_AREAS.type).toBe("MultiPolygon");
    const bounds = VN_ISLAND_AREAS.coordinates.map((poly) => {
      const ring = poly[0];
      const lngs = ring.map((p) => p[0]);
      const lats = ring.map((p) => p[1]);
      return [
        Math.min(...lngs),
        Math.min(...lats),
        Math.max(...lngs),
        Math.max(...lats),
      ];
    });
    expect(bounds).toEqual([
      [110.9, 15.6, 113.0, 17.3],
      [111.4, 6.8, 117.9, 12.2],
    ]);
    for (const l of VN_ISLAND_LABELS) {
      const inside = bounds.some(
        ([w, s, e, n]) => l.lng >= w && l.lng <= e && l.lat >= s && l.lat <= n,
      );
      expect(inside).toBe(true);
    }
  });

  it("hides disputed and maritime boundaries", () => {
    const m = fakeMap();
    applyVietnamSovereignty(asMap(m), "en");
    const f = filterOf(m, "boundary_2");
    expect(f).toContain(JSON.stringify(["!=", ["get", "disputed"], 1]));
    expect(f).toContain(JSON.stringify(["!=", ["get", "maritime"], 1]));
    expect(f).toContain(JSON.stringify(["==", ["get", "admin_level"], 2]));
  });

  it("prefers name:vi for place labels only when the viewer uses Vietnamese", () => {
    const vi1 = fakeMap();
    applyVietnamSovereignty(asMap(vi1), "vi");
    expect(vi1.setLayoutProperty).toHaveBeenCalledWith(
      "label_city",
      "text-field",
      ["coalesce", ["get", "name:vi"], ["get", "name"]],
    );
    // Tên đường không phải địa danh, giữ nguyên.
    expect(
      vi1.setLayoutProperty.mock.calls.some(
        (c) => c[0] === "highway-name-major",
      ),
    ).toBe(false);

    const en = fakeMap();
    applyVietnamSovereignty(asMap(en), "en");
    expect(
      en.setLayoutProperty.mock.calls.some((c) => c[1] === "text-field"),
    ).toBe(false);
  });

  it("hides a label layer whose legacy filter cannot be combined with within", () => {
    const m = fakeMap([
      {
        id: "old_labels",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        filter: ["==", "class", "city"],
        layout: { "text-field": "{name}" },
      },
    ]);
    applyVietnamSovereignty(asMap(m), "en");
    expect(m.setFilter).not.toHaveBeenCalledWith(
      "old_labels",
      expect.anything(),
    );
    expect(m.setLayoutProperty).toHaveBeenCalledWith(
      "old_labels",
      "visibility",
      "none",
    );
  });

  it("does not apply twice to the same style", () => {
    const m = fakeMap();
    applyVietnamSovereignty(asMap(m), "vi");
    applyVietnamSovereignty(asMap(m), "vi");
    // Một nguồn cho nhãn quần đảo, một cho nhãn Biển Đông; lần 2 không thêm nữa.
    expect(m.addSource).toHaveBeenCalledTimes(2);
  });

  it("does not throw and never logs when the map fails", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = fakeMap();
    m.setFilter.mockImplementation(() => {
      throw new Error("boom");
    });
    m.addSource.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(() => applyVietnamSovereignty(asMap(m), "vi")).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
    // setFilter ném lỗi thì layer chữ bị ẩn hẳn.
    expect(m.setLayoutProperty).toHaveBeenCalledWith(
      "label_city",
      "visibility",
      "none",
    );
  });

  it("hides a layer whose filter silently did not apply (maplibre emits an error instead of throwing)", () => {
    const m = fakeMap();
    // Giống maplibre khi filter không hợp lệ: không ném, không đổi gì.
    m.setFilter.mockImplementation(() => {});
    m.getFilter.mockImplementation(() => undefined);
    applyVietnamSovereignty(asMap(m), "en");
    for (const id of ["label_city", "highway-name-major", "boundary_2"]) {
      expect(m.setLayoutProperty).toHaveBeenCalledWith(
        id,
        "visibility",
        "none",
      );
    }
  });

  it("keeps a layer visible when its filter applied", () => {
    const m = fakeMap();
    applyVietnamSovereignty(asMap(m), "en");
    expect(m.setLayoutProperty).not.toHaveBeenCalledWith(
      "label_city",
      "visibility",
      "none",
    );
  });

  describe("East Sea naming (G3-R6)", () => {
    const seaLayers = [
      {
        id: "water_name_point_label",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "water_name",
        filter: [
          "match",
          ["geometry-type"],
          ["MultiPoint", "Point"],
          true,
          false,
        ],
        layout: {
          "text-field": ["get", "name_en"],
          "text-font": ["Noto Sans Italic"],
        },
      },
      {
        id: "label_city",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Italic"],
        },
      },
    ];

    function seaLabel(locale: string): string {
      const m = fakeMap(seaLayers);
      applyVietnamSovereignty(asMap(m), locale);
      const src = m.addSource.mock.calls.find(
        (c) => c[0] === EAST_SEA_LAYER_ID,
      );
      const data = (
        src?.[1] as { data: { features: { properties: { label: string } }[] } }
      ).data;
      return data.features[0].properties.label;
    }

    it("names the sea Biển Đông / East Sea / Biển Đông and never South China Sea", () => {
      expect(seaLabel("vi")).toBe("Biển Đông");
      expect(seaLabel("en")).toBe("East Sea");
      expect(seaLabel("zh")).toBe("Biển Đông");
      for (const name of Object.values(EAST_SEA_LABEL.name)) {
        expect(name).not.toMatch(/South China Sea|南海/);
      }
    });

    it("adds the sea label layer from zoom 3 near 12.5N 113.5E, outside the island areas", () => {
      const m = fakeMap(seaLayers);
      applyVietnamSovereignty(asMap(m), "en");
      const layer = m.addLayer.mock.calls.find(
        (c) => (c[0] as { id: string }).id === EAST_SEA_LAYER_ID,
      )?.[0] as unknown as { type: string; minzoom: number };
      expect(layer.type).toBe("symbol");
      expect(layer.minzoom).toBe(3);
      expect(EAST_SEA_LABEL.lat).toBe(12.5);
      expect(EAST_SEA_LABEL.lng).toBe(113.5);
    });

    it("hides the base sea label whose name says South China Sea or 南海, only on water_name layers", () => {
      const m = fakeMap(seaLayers);
      applyVietnamSovereignty(asMap(m), "en");
      const water = filterOf(m, "water_name_point_label");
      expect(water).toContain("South China Sea");
      expect(water).toContain("南海");
      // Giữ filter cũ của layer.
      expect(water).toContain('"geometry-type"');
      // Địa danh trên đất liền không bị lọc theo tên biển.
      expect(filterOf(m, "label_city")).not.toContain("South China Sea");
    });
  });
});

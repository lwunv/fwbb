// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";
import type { MapPoint } from "@/lib/map/map-points";

type Handler = (e: unknown) => void;

const { maps, FakeMap, FakeMarker } = vi.hoisted(() => {
  const maps: InstanceType<typeof FakeMap>[] = [];

  class FakeMap {
    options: Record<string, unknown>;
    handlers: Record<string, Handler[]> = {};
    layers = new Map<string, unknown>();
    sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
    center = { lng: 105.85, lat: 21.03 };
    remove = vi.fn();
    jumpTo = vi.fn();
    easeTo = vi.fn();
    setFilter = vi.fn();
    setLayoutProperty = vi.fn();
    setPaintProperty = vi.fn();
    moveLayer = vi.fn();
    constructor(options: Record<string, unknown>) {
      this.options = options;
      maps.push(this);
    }
    on(type: string, a: string | Handler, b?: Handler) {
      const key = typeof a === "string" ? `${type}:${a}` : type;
      const fn = (typeof a === "string" ? b : a) as Handler;
      (this.handlers[key] ??= []).push(fn);
      return this;
    }
    off() {
      return this;
    }
    fire(key: string, e: unknown = {}) {
      for (const fn of this.handlers[key] ?? []) fn(e);
    }
    getCenter() {
      return this.center;
    }
    getContainer() {
      return this.options.container as HTMLElement;
    }
    getStyle() {
      return {
        version: 8,
        sources: {},
        layers: [
          {
            id: "label_city",
            type: "symbol",
            source: "openmaptiles",
            "source-layer": "place",
            layout: { "text-field": ["get", "name"] },
          },
        ],
      };
    }
    addSource = vi.fn((id: string) => {
      this.sources.set(id, { setData: vi.fn() });
    });
    getSource(id: string) {
      return this.sources.get(id);
    }
    addLayer = vi.fn((l: { id: string }) => {
      this.layers.set(l.id, l);
    });
    getLayer(id: string) {
      return this.layers.get(id);
    }
  }

  class FakeMarker {
    element: HTMLElement;
    lngLat: [number, number] | null = null;
    constructor(opts: { element: HTMLElement }) {
      this.element = opts.element;
    }
    setLngLat(ll: [number, number]) {
      this.lngLat = ll;
      return this;
    }
    addTo(map: FakeMap) {
      (map.options.container as HTMLElement).appendChild(this.element);
      return this;
    }
    remove() {
      this.element.remove();
      return this;
    }
  }

  return { maps, FakeMap, FakeMarker };
});

vi.mock("maplibre-gl", () => ({
  MapLibreMap: FakeMap,
  Map: FakeMap,
  Marker: FakeMarker,
  setWorkerUrl: vi.fn(),
}));

import { MapView } from "./map-view";

const points: MapPoint[] = [
  { kind: "venue", id: 1, lat: 21.03, lng: 105.85, label: "Sân Cầu Giấy" },
  { kind: "venue", id: 2, lat: 21.01, lng: 105.8, label: "Sân Thanh Xuân" },
];
const center = { lat: 21.03, lng: 105.85 };

function renderMap(props: Partial<Parameters<typeof MapView>[0]> = {}) {
  const ui = (p: Partial<Parameters<typeof MapView>[0]>) => (
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <MapView points={points} center={center} radiusKm={5} {...p} />
    </NextIntlClientProvider>
  );
  const r = render(ui(props));
  return {
    ...r,
    rerenderWith: (p: Partial<Parameters<typeof MapView>[0]>) =>
      r.rerender(ui(p)),
  };
}

function mockWebGL(available: boolean) {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() =>
    available ? ({} as WebGL2RenderingContext) : null) as never);
}

beforeEach(() => {
  maps.length = 0;
  mockWebGL(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MapView", () => {
  it("renders one marker per point with the venue name as label", () => {
    renderMap();
    expect(maps).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Sân Cầu Giấy" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sân Thanh Xuân" })).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("clicking a marker calls onPointClick with that point", () => {
    const onPointClick = vi.fn();
    renderMap({ onPointClick });
    fireEvent.click(screen.getByRole("button", { name: "Sân Thanh Xuân" }));
    expect(onPointClick).toHaveBeenCalledTimes(1);
    expect(onPointClick).toHaveBeenCalledWith(points[1]);
  });

  it("marks the selected venue", () => {
    renderMap({ selectedId: 2 });
    expect(
      screen
        .getByRole("button", { name: "Sân Thanh Xuân" })
        .getAttribute("data-selected"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Sân Cầu Giấy" })
        .getAttribute("data-selected"),
    ).toBe("false");
  });

  it("no WebGL renders the unsupported notice and calls onUnsupported", () => {
    mockWebGL(false);
    const onUnsupported = vi.fn();
    renderMap({ onUnsupported });
    expect(screen.getByText(viMessages.venues.mapUnsupported)).toBeTruthy();
    expect(onUnsupported).toHaveBeenCalledTimes(1);
    expect(maps).toHaveLength(0);
  });

  it("user drag (moveend with originalEvent) calls onMoveEnd, programmatic move does not", () => {
    const onMoveEnd = vi.fn();
    renderMap({ onMoveEnd });
    const map = maps[0];
    map.center = { lng: 105.9, lat: 21.1 };
    map.fire("moveend", {});
    expect(onMoveEnd).not.toHaveBeenCalled();
    map.fire("moveend", { originalEvent: new MouseEvent("mouseup") });
    expect(onMoveEnd).toHaveBeenCalledWith({ lat: 21.1, lng: 105.9 });
  });

  it("unmount removes the map", () => {
    const { unmount } = renderMap();
    unmount();
    expect(maps[0].remove).toHaveBeenCalledTimes(1);
  });

  it("changing points updates markers without creating a new map", () => {
    const { rerenderWith } = renderMap();
    rerenderWith({ points: [points[0]] });
    expect(maps).toHaveLength(1);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Sân Thanh Xuân" })).toBeNull();
  });

  it("applies the sovereignty layer and the radius ring once the style loads", () => {
    renderMap();
    maps[0].fire("style.load");
    const ids = maps[0].addLayer.mock.calls.map((c) => c[0].id);
    expect(ids).toContain("vn-islands");
    expect(ids).toContain("app-radius-fill");
  });

  it("45 points show 45 marker buttons even when the style never loads", () => {
    const many: MapPoint[] = Array.from({ length: 45 }, (_, i) => ({
      kind: "venue",
      id: i + 1,
      lat: 21 + i / 1000,
      lng: 105.8,
      label: `Sân ${i + 1}`,
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderMap({ points: many, selectedId: 45 });
    // openfreemap không tới được: chỉ có `error`, không bao giờ có `load`
    // hay `style.load`.
    maps[0].fire("error", { error: new Error("style fetch failed") });
    expect(screen.getAllByRole("button")).toHaveLength(45);
    expect(
      screen.getByRole("button", { name: "Sân 45" }).dataset.selected,
    ).toBe("true");
    expect(maps[0].addLayer).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "[Map] style_error",
      "style fetch failed",
    );
  });

  it("app layers sit below the sovereignty label", () => {
    renderMap();
    maps[0].fire("style.load");
    const calls = maps[0].addLayer.mock.calls as unknown as [
      { id: string },
      string | undefined,
    ][];
    const appLayers = calls.filter((c) => c[0].id.startsWith("app-"));
    expect(appLayers.length).toBeGreaterThan(0);
    expect(appLayers.every((c) => c[1] === "vn-islands")).toBe(true);
  });

  it("interactive=false makes pins inert so an overlay link gets the tap", () => {
    renderMap({ interactive: false });
    const pins = document.querySelectorAll("button");
    expect(pins).toHaveLength(2);
    for (const pin of pins) {
      expect(pin.tabIndex).toBe(-1);
      expect(pin.getAttribute("aria-hidden")).toBe("true");
      expect(pin.classList.contains("pointer-events-none")).toBe(true);
    }
  });

  it("interactive=false turns off map gestures", () => {
    renderMap({ interactive: false });
    expect(maps[0].options.interactive).toBe(false);
  });

  it("cooperativeGestures is off by default and passes through when set", () => {
    renderMap();
    expect(maps[0].options.cooperativeGestures).toBeFalsy();
    renderMap({ cooperativeGestures: true });
    expect(maps[1].options.cooperativeGestures).toBe(true);
  });

  it("gives maplibre translated strings for gesture hints and attribution", () => {
    renderMap({ cooperativeGestures: true });
    const loc = maps[0].options.locale as Record<string, string>;
    expect(loc["CooperativeGesturesHandler.MobileHelpText"]).toBe(
      viMessages.venues.mapGestureMobile,
    );
    expect(loc["CooperativeGesturesHandler.WindowsHelpText"]).toBe(
      viMessages.venues.mapGestureWindows,
    );
    expect(loc["CooperativeGesturesHandler.MacHelpText"]).toBe(
      viMessages.venues.mapGestureMac,
    );
    expect(loc["AttributionControl.ToggleAttribution"]).toBe(
      viMessages.venues.mapAttributionToggle,
    );
    expect(loc["AttributionControl.MapFeedback"]).toBe(
      viMessages.venues.mapFeedback,
    );
  });

  it("a style or tile error is logged with a code and does not throw", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderMap();
    expect(() =>
      maps[0].fire("error", { error: new Error("tile 404") }),
    ).not.toThrow();
    expect(warn.mock.calls[0][0]).toBe("[Map] style_error");
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
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
    setPadding = vi.fn();
    zoom = 12;
    getZoom = () => this.zoom;
    isEasing = vi.fn(() => false);
    once = vi.fn();
    setFilter = vi.fn();
    setLayoutProperty = vi.fn();
    setPaintProperty = vi.fn();
    moveLayer = vi.fn();
    getFilter = vi.fn();
    cooperativeGestures = { enable: vi.fn(), disable: vi.fn() };
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

const base: MapPoint[] = [
  { kind: "venue", id: 1, lat: 21.03, lng: 105.85, label: "Sân Cầu Giấy" },
];
const withEx = (n: number): MapPoint[] => [
  { ...base[0], exchangeCount: n } as MapPoint,
];
const center = { lat: 21.03, lng: 105.85 };

function renderMap(props: Partial<Parameters<typeof MapView>[0]> = {}) {
  const ui = (p: Partial<Parameters<typeof MapView>[0]>) => (
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <MapView points={base} center={center} radiusKm={5} {...p} />
    </NextIntlClientProvider>
  );
  const r = render(ui(props));
  return {
    ...r,
    rerenderWith: (p: Partial<Parameters<typeof MapView>[0]>) =>
      r.rerender(ui(p)),
  };
}

beforeEach(() => {
  maps.length = 0;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    (() => ({}) as WebGL2RenderingContext) as never,
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const pinLabel = (n: number) => `Sân Cầu Giấy, ${n} buổi giao lưu sắp tới`;

describe("MapView venue exchange pins", () => {
  it("venue pin with exchangeCount 1 shows 1, data-exchange true and the exchanges aria-label", () => {
    renderMap({ points: withEx(1) });
    const pin = screen.getByRole("button", { name: pinLabel(1) });
    expect(pin.getAttribute("data-exchange")).toBe("true");
    const badge = pin.querySelector<HTMLElement>("[data-role=count]")!;
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe("1");
  });

  it("a pin created without exchanges turns into an exchange pin on rerender with count 2, and back to plain at 0", () => {
    const { rerenderWith } = renderMap();
    let pin = screen.getByRole("button", { name: "Sân Cầu Giấy" });
    expect(pin.getAttribute("data-exchange")).toBe("false");
    rerenderWith({ points: withEx(2) });
    pin = screen.getByRole("button", { name: pinLabel(2) });
    expect(pin.getAttribute("data-exchange")).toBe("true");
    expect(pin.querySelector("[data-role=count]")!.textContent).toBe("2");
    rerenderWith({ points: base });
    pin = screen.getByRole("button", { name: "Sân Cầu Giấy" });
    expect(pin.getAttribute("data-exchange")).toBe("false");
    expect((pin.querySelector("[data-role=count]") as HTMLElement).hidden).toBe(
      true,
    );
  });

  it("focus seq change eases to that point with the current bottom padding, without onMoveEnd", () => {
    const onMoveEnd = vi.fn();
    const { rerenderWith } = renderMap({ bottomInset: 120, onMoveEnd });
    const map = maps[0];
    map.zoom = 12;
    rerenderWith({
      bottomInset: 120,
      onMoveEnd,
      focus: { lat: 21.1, lng: 105.9, seq: 1 },
    });
    expect(map.easeTo).toHaveBeenCalledWith({
      center: [105.9, 21.1],
      zoom: 14,
      padding: { bottom: 120 },
    });
    act(() => map.fire("moveend", {}));
    expect(onMoveEnd).not.toHaveBeenCalled();
  });

  it("same focus seq twice eases once", () => {
    const f = { lat: 21.1, lng: 105.9, seq: 1 };
    const { rerenderWith } = renderMap({ focus: f });
    rerenderWith({ focus: { ...f } });
    rerenderWith({ focus: { ...f } });
    expect(maps[0].easeTo).toHaveBeenCalledTimes(1);
  });

  it("bottomInset change sets padding immediately when idle", () => {
    const { rerenderWith } = renderMap({ bottomInset: 72 });
    rerenderWith({ bottomInset: 300 });
    expect(maps[0].setPadding).toHaveBeenLastCalledWith({ bottom: 300 });
  });

  it("bottomInset change during a focus flight waits for moveend and the last easeTo keeps the pin center", () => {
    const f = { lat: 21.1, lng: 105.9, seq: 1 };
    const { rerenderWith } = renderMap({ bottomInset: 72, focus: f });
    const map = maps[0];
    map.setPadding.mockClear();
    rerenderWith({ bottomInset: 300, focus: f });
    expect(map.setPadding).not.toHaveBeenCalled();
    act(() => map.fire("moveend", {}));
    const last = map.easeTo.mock.calls.at(-1)![0];
    expect(last.center).toEqual([105.9, 21.1]);
    expect(last.padding).toEqual({ bottom: 300 });
  });

  it("noticeClassName moves the tiles notice", () => {
    const { rerenderWith } = renderMap({ noticeClassName: "top-32" });
    act(() => maps[0].fire("error", {}));
    const notice = screen.getByText(
      viMessages.venues.mapTilesFailed,
    ).parentElement!;
    expect(notice.className).toContain("top-32");
    expect(notice.className).not.toContain("top-16");
    rerenderWith({});
  });

  it("pin zIndex: plain, exchange, selected plain, selected exchange", () => {
    const pts: MapPoint[] = [
      { kind: "venue", id: 1, lat: 1, lng: 1, label: "P" },
      { kind: "venue", id: 2, lat: 1, lng: 1, label: "E", exchangeCount: 1 },
      { kind: "venue", id: 3, lat: 1, lng: 1, label: "SP" },
      { kind: "venue", id: 4, lat: 1, lng: 1, label: "SE", exchangeCount: 1 },
    ];
    const z = (name: RegExp) =>
      screen.getByRole("button", { name }).style.zIndex;
    const { rerenderWith } = renderMap({ points: pts, selectedId: 3 });
    expect(z(/^P$/)).toBe("");
    expect(z(/^E,/)).toBe("5");
    expect(z(/^SP$/)).toBe("10");
    expect(z(/^SE,/)).toBe("5");
    rerenderWith({ points: pts, selectedId: 4 });
    expect(z(/^SE,/)).toBe("10");
    expect(z(/^SP$/)).toBe("");
  });

  it("after a focus flight completes, a later moveend with a different center does not ease again", () => {
    const { rerenderWith } = renderMap({
      bottomInset: 72,
      focus: { lat: 21.1, lng: 105.9, seq: 1 },
    });
    const map = maps[0];
    act(() => map.fire("moveend", {}));
    const n = map.easeTo.mock.calls.length;
    rerenderWith({
      bottomInset: 300,
      focus: { lat: 21.1, lng: 105.9, seq: 1 },
    });
    map.center = { lng: 106, lat: 22 };
    act(() =>
      map.fire("moveend", { originalEvent: new MouseEvent("mouseup") }),
    );
    expect(map.easeTo.mock.calls.length).toBe(n);
    expect(map.setPadding).toHaveBeenLastCalledWith({ bottom: 300 });
  });
});

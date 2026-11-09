// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { renderToString } from "react-dom/server";
import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import viMessages from "@/i18n/messages/vi.json";
import type { MapViewProps } from "@/components/map/map-view";
import type { VenueSheet as RealVenueSheet } from "@/components/venues/venue-sheet";

type GeoState = {
  status: "idle" | "asking" | "ok" | "denied" | "unsupported";
  position: { lat: number; lng: number } | null;
  label: string | null;
};
type SheetProps = Parameters<typeof RealVenueSheet>[0];

const { listVenuesNear, geocodeAddress, geo, mapProps, sheetProps, viewport } =
  vi.hoisted(() => {
    const initial: GeoState = { status: "idle", position: null, label: null };
    let state: GeoState = initial;
    const listeners = new Set<() => void>();
    return {
      listVenuesNear: vi.fn(),
      geocodeAddress: vi.fn(),
      geo: {
        get: () => state,
        set(next: Partial<GeoState>) {
          state = { ...state, ...next };
          listeners.forEach((l) => l());
        },
        subscribe(l: () => void) {
          listeners.add(l);
          return () => {
            listeners.delete(l);
          };
        },
        reset() {
          state = initial;
          listeners.clear();
        },
        request: vi.fn(),
      },
      mapProps: { last: null as MapViewProps | null },
      sheetProps: { last: null as SheetProps | null },
      viewport: { width: 390 },
    };
  });

vi.mock("@/actions/venues", () => ({ listVenuesNear, geocodeAddress }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/venues/use-user-location", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useUserLocation: () => {
      const s = useSyncExternalStore(geo.subscribe, geo.get, geo.get);
      return { ...s, request: geo.request, setManual: () => {} };
    },
  };
});

// Bản đồ thật cần WebGL: thay bằng stub ghi lại props và có nút giả thao tác.
vi.mock("@/components/map/lazy-map-view", () => ({
  LazyMapView: (p: MapViewProps) => {
    mapProps.last = p;
    return (
      <div data-testid="map" data-center={`${p.center.lat},${p.center.lng}`}>
        {p.points.map((pt) => (
          <button key={pt.id} onClick={() => p.onPointClick?.(pt)}>
            pin-{pt.id}
          </button>
        ))}
        <button onClick={() => p.onMoveEnd?.({ lat: 21.05, lng: 105.8542 })}>
          move-far
        </button>
      </div>
    );
  },
}));

// Ngăn kéo thật (z-10, tiêu đề, danh sách) bọc trong một lớp chỉ để đọc nấc.
vi.mock("@/components/venues/venue-sheet", async (importOriginal) => {
  const mod =
    await importOriginal<typeof import("@/components/venues/venue-sheet")>();
  return {
    VenueSheet: (p: SheetProps) => {
      sheetProps.last = p;
      return (
        <div
          data-testid="sheet-probe"
          data-snap={p.snap}
          data-frozen={String(!!p.frozen)}
        >
          <mod.VenueSheet {...p} />
        </div>
      );
    },
  };
});

import { VenueDirectory } from "./venue-directory";

function venue(id: number, name: string) {
  return {
    id,
    name,
    address: "addr",
    areaLabel: null,
    lat: 21.03 + id / 1000,
    lng: 105.85,
    mapLink: null,
    courtCount: null,
    openHours: null,
    amenities: [],
    phone: null,
    refPricePerHour: null,
    photoLink: null,
    distanceM: 1000,
  };
}

function matchMediaStub(query: string) {
  const min = /min-width:\s*(\d+)px/.exec(query);
  const max = /max-width:\s*(\d+)px/.exec(query);
  const w = viewport.width;
  const matches =
    (!min || w >= Number(min[1])) && (!max || w <= Number(max[1]));
  return {
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  };
}

function setPermissions(state: string) {
  Object.defineProperty(navigator, "permissions", {
    value: { query: async () => ({ state }) },
    configurable: true,
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Opts = {
  search?: string;
  exchangeEnabled?: boolean;
  loadExchangeCounts?: (ids: number[]) => Promise<[number, number][]>;
  canSuggest?: boolean;
};

function tree(opts: Opts, onUrlUpdate = vi.fn()): ReactNode {
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <NextIntlClientProvider
        locale="vi"
        messages={viMessages}
        timeZone="Asia/Ho_Chi_Minh"
      >
        <NuqsTestingAdapter
          searchParams={opts.search ?? ""}
          hasMemory
          resetUrlUpdateQueueOnMount={false}
          onUrlUpdate={onUrlUpdate}
        >
          <VenueDirectory
            canSuggest={opts.canSuggest ?? false}
            exchangeEnabled={opts.exchangeEnabled ?? false}
            loadExchangeCounts={opts.loadExchangeCounts}
          />
        </NuqsTestingAdapter>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

function renderDir(opts: Opts = {}) {
  const onUrlUpdate = vi.fn();
  const r = render(tree(opts, onUrlUpdate));
  const lastUrl = () =>
    onUrlUpdate.mock.calls.at(-1)?.[0] as
      | { searchParams: URLSearchParams }
      | undefined;
  return { ...r, onUrlUpdate, lastUrl };
}

const snap = () => screen.getByTestId("sheet-probe").getAttribute("data-snap");
const sheet = () => screen.getByTestId("venue-sheet");
const sheetTitle = () =>
  within(screen.getByTestId("venue-sheet-handle")).getByRole("button");
const overlay = () => screen.getByTestId("venues-overlay");

beforeEach(() => {
  viewport.width = 390;
  Object.defineProperty(window, "matchMedia", {
    value: vi.fn(matchMediaStub),
    configurable: true,
    writable: true,
  });
  mapProps.last = null;
  sheetProps.last = null;
  listVenuesNear.mockReset();
  listVenuesNear.mockResolvedValue({
    venues: [venue(1, "Sân Một"), venue(2, "Sân Hai")],
  });
  geocodeAddress.mockReset();
  geo.reset();
  geo.request.mockReset();
  geo.request.mockImplementation(() => geo.set({ status: "asking" }));
  localStorage.clear();
  setPermissions("prompt");
});

afterEach(async () => {
  vi.restoreAllMocks();
  // Hàng đợi URL của nuqs dùng chung: chờ xả xong để lần ghi cuối không lọt
  // sang test sau (resetUrlUpdateQueueOnMount tắt, xem test của hook).
  await act(async () => {
    await sleep(20);
  });
  cleanup();
});

describe("VenueDirectory: map-first layout", () => {
  it("renders the map on first client paint at Hà Nội while GPS is asking, with the viewing-around line", async () => {
    renderDir();
    const map = screen.getByTestId("map");
    expect(map.getAttribute("data-center")).toBe("21.0285,105.8542");
    expect(
      await screen.findByText(
        "Đang xem quanh Hà Nội. Bật vị trí hoặc gõ khu vực để đổi.",
      ),
    ).toBeTruthy();
    await screen.findByText("Sân Một");
  });

  it("server render (renderToString) shows the panel skeleton, no map and no grid-cols-[400px without the md: prefix", () => {
    const html = renderToString(tree({}));
    expect(html).toContain('data-testid="venues-panel-skeleton"');
    expect(html).not.toContain('data-testid="map"');
    expect(html).toContain("md:grid-cols-[400px_minmax(0,1fr)]");
    expect(html).not.toMatch(/(^|[\s"])grid-cols-\[400px/);
  });

  it("the map wrapper has class isolate, the overlay z-20 and the sheet z-10", async () => {
    renderDir();
    await screen.findByText("Sân Một");
    const wrapper = screen.getByTestId("map").closest(".isolate");
    expect(wrapper).not.toBeNull();
    expect(wrapper!.className).toContain("md:col-start-2");
    expect(overlay().className).toContain("z-20");
    expect(sheet().className).toContain("z-10");
    expect(overlay().contains(sheet())).toBe(false);
  });

  it("overlay row is pointer-events-none and its controls pointer-events-auto", async () => {
    renderDir();
    await screen.findByText("Sân Một");
    expect(overlay().className).toContain("pointer-events-none");
    const search = screen.getByRole("combobox");
    expect(search.closest(".pointer-events-auto")).not.toBeNull();
    const chipRow = screen.getByTestId("venues-chip-row");
    expect(chipRow.className).toContain("pointer-events-none");
    expect(chipRow.className).toContain("[&_button]:pointer-events-auto");
    expect(
      chipRow.contains(screen.getByRole("button", { name: /Bán kính 5 km/ })),
    ).toBe(true);
  });

  it("the venues map never uses cooperative gestures", async () => {
    renderDir();
    await screen.findByText("Sân Một");
    expect(mapProps.last?.cooperativeGestures).toBe(false);
    cleanup();
    viewport.width = 1280;
    renderDir();
    await waitFor(() => expect(mapProps.last).not.toBeNull());
    expect(mapProps.last?.cooperativeGestures).toBe(false);
  });

  it("the search-here pill calls searchHere", async () => {
    renderDir();
    await screen.findByText("Sân Một");
    expect(listVenuesNear).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "move-far" }));
    const pill = await screen.findByRole("button", {
      name: "Tìm ở khu vực này",
    });
    expect(overlay().contains(pill)).toBe(true);
    fireEvent.click(pill);
    await waitFor(() => expect(listVenuesNear).toHaveBeenCalledTimes(2));
    expect(listVenuesNear.mock.calls[1][0]).toMatchObject({
      lat: 21.05,
      lng: 105.8542,
      radiusKm: 5,
    });
  });

  it("keeps the pins and shows a loading pill while a new area loads", async () => {
    renderDir();
    await screen.findByRole("button", { name: "pin-1" });
    let resolve!: (v: unknown) => void;
    listVenuesNear.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    fireEvent.click(screen.getByRole("button", { name: /Bán kính 5 km/ }));
    fireEvent.click(await screen.findByRole("radio", { name: "10 km" }));
    expect(await screen.findByText("Đang tải sân...")).toBeTruthy();
    expect(screen.getByRole("button", { name: "pin-1" })).toBeTruthy();
    await act(async () => {
      resolve({ venues: [venue(1, "Sân Một")] });
    });
    await waitFor(() =>
      expect(screen.queryByText("Đang tải sân...")).toBeNull(),
    );
  });

  it("the loading pill replaces the search-here pill while fetching", async () => {
    renderDir();
    await screen.findByText("Sân Một");
    fireEvent.click(screen.getByRole("button", { name: "move-far" }));
    await screen.findByRole("button", { name: "Tìm ở khu vực này" });
    let resolve!: (v: unknown) => void;
    listVenuesNear.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    // Đổi tiện ích tải lại cùng vùng mà không xoá vị trí kéo bản đồ.
    fireEvent.click(screen.getByRole("button", { name: "Tiện ích" }));
    fireEvent.click(await screen.findByRole("button", { name: "Gửi xe" }));
    const pill = await screen.findByText("Đang tải sân...");
    expect(pill.closest('[role="status"]')?.className).toContain(
      "pointer-events-none",
    );
    expect(
      screen.queryByRole("button", { name: "Tìm ở khu vực này", hidden: true }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Xong" }));
    await act(async () => {
      resolve({ venues: [venue(1, "Sân Một")] });
    });
    await screen.findByRole("button", { name: "Tìm ở khu vực này" });
  });
});

describe("VenueDirectory: sheet", () => {
  it("tapping a pin shows the quick view in the sheet at mid and passes focus to the map", async () => {
    renderDir();
    fireEvent.click(await screen.findByRole("button", { name: "pin-2" }));
    await waitFor(() => expect(snap()).toBe("mid"));
    const close = await within(sheet()).findByRole("button", { name: "Đóng" });
    expect(close).toBeTruthy();
    expect(within(sheet()).getByText("Sân Hai")).toBeTruthy();
    expect(within(sheet()).queryByText("Sân Một")).toBeNull();
    expect(mapProps.last?.focus).toMatchObject({
      lat: venue(2, "").lat,
      lng: venue(2, "").lng,
    });
  });

  it("load error shows in the sheet at mid with retry", async () => {
    listVenuesNear.mockResolvedValue({ error: "boom" });
    renderDir();
    const retry = await within(sheet()).findByRole("button", {
      name: "Thử lại",
    });
    expect(screen.getByText(viMessages.venues.loadError)).toBeTruthy();
    expect(snap()).toBe("mid");
    listVenuesNear.mockResolvedValue({ venues: [venue(1, "Sân Một")] });
    fireEvent.click(retry);
    await within(sheet()).findByText("Sân Một");
    expect(listVenuesNear).toHaveBeenCalledTimes(2);
  });

  it("empty result opens the sheet at mid with expand radius", async () => {
    listVenuesNear.mockResolvedValue({ venues: [] });
    renderDir({ canSuggest: true });
    const expand = await within(sheet()).findByRole("button", {
      name: viMessages.venues.expandRadius,
    });
    expect(snap()).toBe("mid");
    expect(
      within(sheet()).getByText("Chưa có sân nào trong 5 km"),
    ).toBeTruthy();
    expect(
      within(sheet()).getByRole("link", {
        name: viMessages.venues.suggestVenue,
      }),
    ).toBeTruthy();
    fireEvent.click(expand);
    await waitFor(() => expect(listVenuesNear).toHaveBeenCalledTimes(2));
    expect(listVenuesNear.mock.calls[1][0]).toMatchObject({ radiusKm: 10 });
  });

  it("picking a name suggestion selects that venue and moves the sheet to mid", async () => {
    const { lastUrl } = renderDir();
    await screen.findByText("Sân Một");
    expect(snap()).toBe("low");
    const input = screen.getByRole("combobox");
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "Hai" } });
    fireEvent.click(await screen.findByRole("option", { name: /Sân Hai/ }));
    await waitFor(() => expect(snap()).toBe("mid"));
    expect(screen.getByTestId("sheet-probe").getAttribute("data-frozen")).toBe(
      "false",
    );
    await within(sheet()).findByRole("button", { name: "Đóng" });
    await waitFor(() => expect(lastUrl()?.searchParams.get("venue")).toBe("2"));
  });

  it("opening with a valid ?venue= shows the quick view at mid", async () => {
    renderDir({ search: "?venue=2" });
    await within(sheet()).findByRole("button", { name: "Đóng" });
    expect(within(sheet()).getByText("Sân Hai")).toBeTruthy();
    await waitFor(() => expect(snap()).toBe("mid"));
  });

  it("focusing the search box moves the sheet to low and blur restores it", async () => {
    renderDir();
    await screen.findByText("Sân Một");
    fireEvent.click(sheetTitle());
    await waitFor(() => expect(snap()).toBe("mid"));
    const input = screen.getByRole("combobox");
    act(() => input.focus());
    expect(snap()).toBe("low");
    expect(screen.getByTestId("sheet-probe").getAttribute("data-frozen")).toBe(
      "true",
    );
    act(() => input.blur());
    expect(snap()).toBe("mid");
    expect(screen.getByTestId("sheet-probe").getAttribute("data-frozen")).toBe(
      "false",
    );
  });

  it("X returns to the list at the same snap; drag close returns to low", async () => {
    const { lastUrl } = renderDir();
    fireEvent.click(await screen.findByRole("button", { name: "pin-2" }));
    await waitFor(() => expect(snap()).toBe("mid"));
    fireEvent.click(sheetTitle());
    await waitFor(() => expect(snap()).toBe("high"));
    fireEvent.click(
      await within(sheet()).findByRole("button", { name: "Đóng" }),
    );
    await within(sheet()).findByText("Sân Một");
    expect(snap()).toBe("high");

    fireEvent.click(screen.getByRole("button", { name: "pin-1" }));
    await waitFor(() => expect(snap()).toBe("mid"));
    await within(sheet()).findByRole("button", { name: "Đóng" });
    expect(sheetProps.last?.onDragClose).toBeTypeOf("function");
    act(() => sheetProps.last!.onDragClose!());
    await waitFor(() => expect(snap()).toBe("low"));
    await waitFor(() =>
      expect(
        within(sheet()).queryByRole("button", { name: "Đóng" }),
      ).toBeNull(),
    );
    await waitFor(() =>
      expect(lastUrl()?.searchParams.get("venue")).toBeNull(),
    );
  });

  it("exchange filter pending shows skeleton cards and a title without a number", async () => {
    renderDir({
      search: "?exchange=true",
      exchangeEnabled: true,
      loadExchangeCounts: () => new Promise(() => {}),
    });
    await waitFor(() => expect(listVenuesNear).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getAllByTestId("venue-card-skeleton")).toHaveLength(3),
    );
    const title = sheetTitle().textContent ?? "";
    expect(title).toContain(viMessages.venues.pageTitle);
    expect(title).not.toMatch(/\d/);
  });

  it("shows the venue count in the sheet title once loaded", async () => {
    renderDir();
    await screen.findByText("Sân Một");
    expect(sheetTitle().textContent).toContain("2 sân quanh đây");
  });
});

describe("VenueDirectory: status row", () => {
  it("counts error shows the notice with retry above the map", async () => {
    const counts = vi.fn().mockRejectedValue(new Error("boom"));
    renderDir({
      search: "?exchange=true",
      exchangeEnabled: true,
      loadExchangeCounts: counts,
    });
    const notice = await screen.findByText(
      viMessages.venues.exchangeFilterUnavailable,
    );
    expect(overlay().contains(notice)).toBe(true);
    const retry = within(overlay()).getByRole("button", { name: "Thử lại" });
    counts.mockResolvedValue([[1, 3]]);
    fireEvent.click(retry);
    await waitFor(() =>
      expect(
        screen.queryByText(viMessages.venues.exchangeFilterUnavailable),
      ).toBeNull(),
    );
  });

  it("place search shows the viewing-place line with the island label", async () => {
    geocodeAddress.mockResolvedValue({
      lat: 10,
      lng: 114,
      label: "Spratly Islands",
    });
    renderDir();
    await screen.findByText("Sân Một");
    const input = screen.getByRole("combobox");
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "spratly" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(
      await screen.findByText("Đang xem quanh Quần đảo Trường Sa (Việt Nam)"),
    ).toBeTruthy();
    await waitFor(() =>
      expect(listVenuesNear).toHaveBeenLastCalledWith(
        expect.objectContaining({ lat: 10, lng: 114 }),
      ),
    );
    expect(screen.queryByText(/Bật vị trí hoặc gõ khu vực để đổi/)).toBeNull();
  });

  it("shows the locating pill while a granted GPS is answering", async () => {
    setPermissions("granted");
    renderDir();
    expect(await screen.findByText(viMessages.venues.locating)).toBeTruthy();
    expect(listVenuesNear).not.toHaveBeenCalled();
    act(() => geo.set({ status: "ok", position: { lat: 21.0, lng: 105.8 } }));
    await waitFor(() => expect(listVenuesNear).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByText(viMessages.venues.locating)).toBeNull(),
    );
  });
});

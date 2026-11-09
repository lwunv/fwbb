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

type GeoState = {
  status: "idle" | "asking" | "ok" | "denied" | "unsupported";
  position: { lat: number; lng: number } | null;
  label: string | null;
};

const {
  listVenuesNear,
  geocodeAddress,
  geo,
  mapProps,
  mapLife,
  viewport,
  router,
} = vi.hoisted(() => {
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
    /** Số lần stub bản đồ được mount / gỡ: đổi bố cục không được dựng lại bản đồ. */
    mapLife: { mounts: 0, unmounts: 0 },
    viewport: { width: 390, listeners: new Set<() => void>() },
    router: { push: vi.fn() },
  };
});

vi.mock("@/actions/venues", () => ({ listVenuesNear, geocodeAddress }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/venues/use-user-location", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useUserLocation: () => {
      const s = useSyncExternalStore(geo.subscribe, geo.get, geo.get);
      return { ...s, request: geo.request, setManual: () => {} };
    },
  };
});

// Bản đồ thật cần WebGL: stub ghi props, đếm mount và có nút giả để báo
// "máy không dựng được bản đồ" như MapView làm qua onUnsupported.
vi.mock("@/components/map/lazy-map-view", async () => {
  const { useEffect } = await import("react");
  return {
    LazyMapView: (p: MapViewProps) => {
      mapProps.last = p;
      useEffect(() => {
        mapLife.mounts += 1;
        return () => {
          mapLife.unmounts += 1;
        };
      }, []);
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
          <button onClick={() => p.onUnsupported?.()}>
            report-unsupported
          </button>
        </div>
      );
    },
  };
});

import { VenueDirectory } from "./venue-directory";
import Loading from "./loading";

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

/** Như stub của Task 8, thêm danh sách listener để giả lập đổi bề rộng cửa sổ. */
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
    addEventListener: (_type: string, l: () => void) =>
      viewport.listeners.add(l),
    removeEventListener: (_type: string, l: () => void) =>
      viewport.listeners.delete(l),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  };
}

function resize(width: number) {
  act(() => {
    viewport.width = width;
    viewport.listeners.forEach((l) => l());
  });
}

function mockWebGL(available: boolean) {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() =>
    available ? ({} as WebGL2RenderingContext) : null) as never);
}

function setPermissions(state: string) {
  Object.defineProperty(navigator, "permissions", {
    value: { query: async () => ({ state }) },
    configurable: true,
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Opts = { search?: string; canSuggest?: boolean };

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
            exchangeEnabled={false}
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

const column = () => screen.getByTestId("venues-column");
const mapWrapper = () =>
  screen.getByTestId("map").closest(".isolate") as HTMLElement;
const classes = (el: Element) => el.className.split(/\s+/);
/** `a` đứng trước `b` trong tài liệu. */
const precedes = (a: Node, b: Node) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

beforeEach(() => {
  viewport.width = 390;
  viewport.listeners.clear();
  Object.defineProperty(window, "matchMedia", {
    value: vi.fn(matchMediaStub),
    configurable: true,
    writable: true,
  });
  mockWebGL(true);
  mapProps.last = null;
  mapLife.mounts = 0;
  mapLife.unmounts = 0;
  router.push.mockReset();
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

describe("VenueDirectory: desktop two columns", () => {
  it("desktop shows the list in the left column and no bottom sheet", async () => {
    viewport.width = 1280;
    renderDir();
    const col = await screen.findByTestId("venues-column");
    await within(col).findByText("Sân Một");
    expect(within(col).getByText("Sân Hai")).toBeTruthy();
    expect(within(col).getByText("2 sân quanh đây")).toBeTruthy();
    expect(classes(col)).toEqual(expect.arrayContaining(["hidden", "md:flex"]));
    expect(classes(col)).toContain("md:col-start-1");
    // Ô tìm, chip và hàng trạng thái nằm trong cột trái.
    const search = within(col).getByRole("combobox");
    expect(
      within(col).getByRole("button", { name: /Bán kính 5 km/ }),
    ).toBeTruthy();
    expect(
      within(col).getByText(
        "Đang xem quanh Hà Nội. Bật vị trí hoặc gõ khu vực để đổi.",
      ),
    ).toBeTruthy();
    // Gợi ý của ô tìm phải nằm trên chip và thẻ sân (thẻ có nút z-10).
    expect(classes(search.closest(".z-10")!)).toEqual(
      expect.arrayContaining(["relative", "z-10"]),
    );
    const list = within(col).getByText("Sân Một").closest(".isolate");
    expect(list).not.toBeNull();
    expect(list!.contains(search)).toBe(false);
    // Thẻ là nút chọn sân, như trong ngăn kéo.
    expect(within(col).getByRole("button", { name: "Sân Một" })).toBeTruthy();

    expect(screen.queryByTestId("venue-sheet")).toBeNull();
    expect(screen.queryByTestId("venues-overlay")).toBeNull();
    expect(col.contains(mapWrapper())).toBe(false);
    // Không có ngăn che bản đồ: tâm không lệch, ô nguồn bản đồ ở góc dưới phải.
    expect(mapProps.last?.bottomInset).toBe(0);
    const frame = mapWrapper().closest(".fixed") as HTMLElement;
    expect(frame.style.getPropertyValue("--venues-map-inset")).toBe("0px");
    expect(classes(mapWrapper())).toContain(
      "[&_.maplibregl-ctrl-bottom-right]:bottom-[var(--venues-map-inset)]!",
    );
    // Khối báo lỗi nền bản đồ nằm dưới viên nổi trên bản đồ.
    expect(frame.style.getPropertyValue("--venues-top-reserve")).toBe("64px");
  });

  it("tapping a pin on desktop swaps the column to the quick view without a dialog; back returns to the list and clears ?venue=", async () => {
    viewport.width = 1280;
    const { lastUrl } = renderDir();
    fireEvent.click(await screen.findByRole("button", { name: "pin-2" }));
    const back = await within(column()).findByRole("button", {
      name: viMessages.venues.backToList,
    });
    expect(
      within(column()).getByRole("heading", { name: "Sân Hai" }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(within(column()).queryByText("Sân Một")).toBeNull(),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("venue-sheet")).toBeNull();
    expect(mapProps.last?.focus).toMatchObject({
      lat: venue(2, "").lat,
      lng: venue(2, "").lng,
    });
    await waitFor(() => expect(lastUrl()?.searchParams.get("venue")).toBe("2"));

    fireEvent.click(back);
    await within(column()).findByText("Sân Một");
    expect(
      within(column()).queryByRole("button", {
        name: viMessages.venues.backToList,
      }),
    ).toBeNull();
    await waitFor(() =>
      expect(lastUrl()?.searchParams.get("venue")).toBeNull(),
    );
  });

  it("desktop floats the search-here and loading pills over the map, not in the column", async () => {
    viewport.width = 1280;
    renderDir();
    await within(await screen.findByTestId("venues-column")).findByText(
      "Sân Một",
    );
    fireEvent.click(screen.getByRole("button", { name: "move-far" }));
    const pill = await screen.findByRole("button", {
      name: "Tìm ở khu vực này",
    });
    expect(mapWrapper().contains(pill)).toBe(true);
    expect(column().contains(pill)).toBe(false);
    const layer = screen.getByTestId("venues-map-pills");
    expect(classes(layer)).toEqual(
      expect.arrayContaining(["z-20", "pointer-events-none"]),
    );
    expect(classes(pill)).toContain("pointer-events-auto");

    let resolve!: (v: unknown) => void;
    listVenuesNear.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    fireEvent.click(pill);
    const loading = await screen.findByText("Đang tải sân...");
    expect(layer.contains(loading)).toBe(true);
    await act(async () => {
      resolve({ venues: [venue(1, "Sân Một")] });
    });
    await waitFor(() =>
      expect(screen.queryByText("Đang tải sân...")).toBeNull(),
    );
  });

  it("switching between mobile and desktop widths keeps the same map instance", async () => {
    renderDir();
    await screen.findByText("Sân Một");
    expect(screen.getByTestId("venue-sheet")).toBeTruthy();
    expect(mapLife.mounts).toBe(1);

    resize(1280);
    await within(await screen.findByTestId("venues-column")).findByText(
      "Sân Một",
    );
    expect(screen.queryByTestId("venue-sheet")).toBeNull();
    expect(mapProps.last?.bottomInset).toBe(0);

    resize(390);
    expect(await screen.findByTestId("venue-sheet")).toBeTruthy();
    expect(screen.queryByTestId("venues-column")).toBeNull();

    expect(mapLife.mounts).toBe(1);
    expect(mapLife.unmounts).toBe(0);
    // Đổi bố cục không tải lại dữ liệu.
    expect(listVenuesNear).toHaveBeenCalledTimes(1);
  });

  it("the route skeleton covers both layouts and is reused before the width is known", () => {
    const { container } = render(<Loading />);
    const frame = container.firstElementChild as HTMLElement;
    expect(classes(frame)).toEqual(
      expect.arrayContaining([
        "fixed",
        "top-14",
        "md:grid-cols-[400px_minmax(0,1fr)]",
      ]),
    );
    const mobile = screen.getByTestId("venues-panel-skeleton");
    expect(classes(mobile)).toContain("md:hidden");
    expect(mobile.querySelectorAll(".h-11.rounded-full.w-full")).toHaveLength(
      1,
    );
    expect(mobile.querySelectorAll(".h-11.w-28")).toHaveLength(4);
    expect(mobile.querySelectorAll(".h-\\[72px\\]")).toHaveLength(1);

    const col = screen.getByTestId("venues-column-skeleton");
    expect(classes(col)).toEqual(
      expect.arrayContaining(["hidden", "md:flex", "md:col-start-1"]),
    );
    expect(col.querySelectorAll(".h-11.rounded-full.w-full")).toHaveLength(1);
    expect(col.querySelectorAll(".h-11.w-28")).toHaveLength(4);
    expect(within(col).getAllByTestId("venue-card-skeleton")).toHaveLength(3);
    expect(frame.querySelector(".md\\:col-start-2")).not.toBeNull();
    cleanup();

    // Trước khi biết bề rộng máy, màn dùng lại đúng skeleton đó.
    const html = renderToString(tree({}));
    expect(html).toContain('data-testid="venues-panel-skeleton"');
    expect(html).toContain('data-testid="venues-column-skeleton"');
  });
});

describe("VenueDirectory: no WebGL", () => {
  it("map reports unsupported → full list page with the explanation line, the OSM attribution and no map", async () => {
    renderDir({ canSuggest: true });
    await screen.findByText("Sân Một");
    fireEvent.click(screen.getByRole("button", { name: "report-unsupported" }));

    const page = await screen.findByTestId("venues-list-page");
    expect(screen.queryByTestId("map")).toBeNull();
    expect(mapLife.unmounts).toBe(1);
    expect(page.closest(".fixed")).toBeNull();
    expect(screen.queryByTestId("venue-sheet")).toBeNull();

    const title = within(page).getByRole("heading", {
      level: 1,
      name: viMessages.venues.pageTitle,
    });
    expect(classes(title)).not.toContain("sr-only");
    const search = within(page).getByRole("combobox");
    const radiusChip = within(page).getByRole("button", {
      name: /Bán kính 5 km/,
    });
    const explain = within(page).getByText(viMessages.venues.mapUnsupported);
    const first = within(page).getByText("Sân Một");
    const last = within(page).getByText("Sân Hai");
    const suggest = within(page).getByRole("link", {
      name: viMessages.venues.suggestVenue,
    });
    const attribution = within(page).getByText(viMessages.venues.attribution);
    // Thứ tự trang: tiêu đề, ô tìm, chip, dòng giải thích, danh sách, đề xuất sân, nguồn OSM.
    expect(precedes(title, search)).toBe(true);
    expect(precedes(search, radiusChip)).toBe(true);
    expect(precedes(radiusChip, explain)).toBe(true);
    expect(precedes(explain, first)).toBe(true);
    expect(precedes(last, suggest)).toBe(true);
    expect(precedes(suggest, attribution)).toBe(true);
    // Đổi sang trang danh sách không tải lại dữ liệu.
    expect(listVenuesNear).toHaveBeenCalledTimes(1);
  });

  it("without WebGL2 the map never mounts and the server snapshot assumes support", async () => {
    mockWebGL(false);
    const html = renderToString(tree({}));
    expect(html).toContain('data-testid="venues-panel-skeleton"');
    expect(html).not.toContain('data-testid="venues-list-page"');
    expect(html).not.toContain(viMessages.venues.mapUnsupported);

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    render(tree({}), { container, hydrate: true });
    expect(
      await screen.findByText(viMessages.venues.mapUnsupported),
    ).toBeTruthy();
    await screen.findByText("Sân Một");
    expect(screen.queryByTestId("map")).toBeNull();
    expect(mapLife.mounts).toBe(0);
  });

  it("without WebGL the card name links to the detail page", async () => {
    mockWebGL(false);
    renderDir({ canSuggest: true });
    const link = await screen.findByRole("link", { name: "Sân Hai" });
    expect(link.getAttribute("href")).toBe("/venues/2");
    expect(screen.queryByRole("button", { name: "Sân Hai" })).toBeNull();
    expect(
      screen
        .getByRole("link", { name: viMessages.venues.suggestVenue })
        .getAttribute("href"),
    ).toBe("/venues/suggest");
  });

  it("without WebGL picking a name suggestion opens the detail page", async () => {
    mockWebGL(false);
    renderDir();
    await screen.findByRole("link", { name: "Sân Một" });
    const input = screen.getByRole("combobox");
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "Hai" } });
    fireEvent.click(await screen.findByRole("option", { name: /Sân Hai/ }));
    expect(router.push).toHaveBeenCalledWith("/venues/2");
  });
});

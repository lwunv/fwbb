// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import viMessages from "@/i18n/messages/vi.json";
import type { MapViewProps } from "@/components/map/map-view";

const { listVenuesNear, mobile, mapProps, locState } = vi.hoisted(() => ({
  listVenuesNear: vi.fn(),
  locState: { status: "ok" as "ok" | "asking" },
  mobile: { value: true },
  mapProps: { last: null as null | { cooperativeGestures?: boolean } },
}));

vi.mock("@/actions/venues", () => ({ listVenuesNear }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/use-is-mobile", () => ({ useIsMobile: () => mobile.value }));
vi.mock("@/components/venues/use-user-location", () => ({
  useUserLocation: () => ({
    status: locState.status,
    position: locState.status === "ok" ? { lat: 21.0, lng: 105.8 } : null,
    label: "Hà Nội",
    request: () => {},
    setManual: () => {},
  }),
}));

// Bản đồ thật cần WebGL: thay bằng stub có nút giả lập thao tác.
vi.mock("@/components/map/lazy-map-view", () => ({
  LazyMapView: (p: MapViewProps) => (
    <div
      data-testid="map"
      ref={() => {
        mapProps.last = p;
      }}
      data-center={`${p.center.lat},${p.center.lng}`}
    >
      {p.points.map((pt) => (
        <button key={pt.id} onClick={() => p.onPointClick?.(pt)}>
          pin-{pt.id}
        </button>
      ))}
      <button onClick={() => p.onMoveEnd?.({ lat: 21.05, lng: 105.8 })}>
        move-far
      </button>
      <button onClick={() => p.onMoveEnd?.({ lat: 21.001, lng: 105.8 })}>
        move-near
      </button>
      <button onClick={() => p.onUnsupported?.()}>no-webgl</button>
    </div>
  ),
}));

import { VenueDirectory } from "./venue-directory";

const venue = (id: number, name: string) => ({
  id,
  name,
  address: "addr",
  areaLabel: null,
  lat: 21.0 + id / 1000,
  lng: 105.8,
  mapLink: null,
  courtCount: null,
  openHours: null,
  amenities: [],
  phone: null,
  refPricePerHour: null,
  photoLink: null,
  distanceM: 1000,
});

function renderDir(search = "") {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <NextIntlClientProvider locale="vi" messages={viMessages}>
        <NuqsTestingAdapter searchParams={search}>
          <VenueDirectory canSuggest={false} />
        </NuqsTestingAdapter>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mobile.value = true;
  locState.status = "ok";
  listVenuesNear.mockResolvedValue({
    venues: [venue(1, "Sân Một"), venue(2, "Sân Hai")],
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("VenueDirectory map mode", () => {
  it("list view does not render the map", async () => {
    renderDir();
    await screen.findByText("Sân Một");
    expect(screen.queryByTestId("map")).toBeNull();
  });

  it("switching to map and back calls listVenuesNear once", async () => {
    renderDir();
    await screen.findByText("Sân Một");
    fireEvent.click(screen.getByRole("button", { name: "Bản đồ" }));
    await screen.findByTestId("map");
    fireEvent.click(screen.getByRole("button", { name: "Danh sách" }));
    await screen.findByText("Sân Một");
    expect(listVenuesNear).toHaveBeenCalledTimes(1);
  });

  it("moving the map past 30% of the radius shows search this area; pressing it queries with the map center and a radius change keeps that center", async () => {
    renderDir("?view=map");
    await screen.findByTestId("map");
    await waitFor(() => expect(listVenuesNear).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "move-near" }));
    expect(
      screen.queryByRole("button", { name: "Tìm ở khu vực này" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "move-far" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Tìm ở khu vực này" }),
    );
    await waitFor(() => expect(listVenuesNear).toHaveBeenCalledTimes(2));
    expect(listVenuesNear.mock.calls[1][0]).toMatchObject({
      lat: 21.05,
      lng: 105.8,
      radiusKm: 5,
    });
    // Nút thoát có animation nên biến mất sau một nhịp.
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Tìm ở khu vực này" }),
      ).toBeNull(),
    );
    expect(screen.getByText("Khu vực đã chọn")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "10 km" }));
    await waitFor(() => expect(listVenuesNear).toHaveBeenCalledTimes(3));
    expect(listVenuesNear.mock.calls[2][0]).toMatchObject({
      lat: 21.05,
      lng: 105.8,
      radiusKm: 10,
    });

    fireEvent.click(screen.getByRole("button", { name: /vị trí của tôi/i }));
    await waitFor(() => expect(listVenuesNear).toHaveBeenCalledTimes(4));
    expect(listVenuesNear.mock.calls[3][0]).toMatchObject({ lat: 21.0 });
  });

  it("mobile map uses cooperative gestures, desktop map does not", async () => {
    renderDir("?view=map");
    await screen.findByTestId("map");
    expect(mapProps.last?.cooperativeGestures).toBe(true);
    cleanup();
    mobile.value = false;
    renderDir("?view=map");
    await screen.findByTestId("map");
    expect(mapProps.last?.cooperativeGestures).toBe(false);
  });

  it("tapping a pin on mobile opens a bottom sheet with that venue card", async () => {
    renderDir("?view=map");
    fireEvent.click(await screen.findByRole("button", { name: "pin-2" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Sân Hai");
    expect(dialog.textContent).not.toContain("Sân Một");
    expect(dialog.getAttribute("data-side")).toBe("bottom");
  });

  it("tapping a pin on desktop shows a side panel without a dialog", async () => {
    mobile.value = false;
    renderDir("?view=map");
    fireEvent.click(await screen.findByRole("button", { name: "pin-1" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await screen.findByText("Sân Một", { selector: "a" })).toBeTruthy();
  });

  it("map reports unsupported → view returns to list", async () => {
    renderDir("?view=map");
    fireEvent.click(await screen.findByRole("button", { name: "no-webgl" }));
    await screen.findByText("Sân Một");
    expect(screen.queryByTestId("map")).toBeNull();
    // Khoá nút thay vì báo toast lặp lại.
    const toggle = screen.getByRole("button", { name: "Bản đồ" });
    expect(toggle.hasAttribute("disabled")).toBe(true);
    expect(toggle.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText(viMessages.venues.mapUnsupported)).toBeTruthy();
  });

  it("keeps the pins and shows a loading pill while a new area loads", async () => {
    renderDir("?view=map");
    await screen.findByRole("button", { name: "pin-1" });
    let resolve!: (v: unknown) => void;
    listVenuesNear.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    fireEvent.click(screen.getByRole("button", { name: "10 km" }));
    expect(await screen.findByText("Đang tải sân...")).toBeTruthy();
    expect(screen.getByRole("button", { name: "pin-1" })).toBeTruthy();
    resolve({ venues: [venue(1, "Sân Một")] });
    await waitFor(() =>
      expect(screen.queryByText("Đang tải sân...")).toBeNull(),
    );
  });

  it("while locating in map mode shows a map-sized skeleton, not the list skeleton", () => {
    locState.status = "asking";
    const { container } = renderDir("?view=map");
    expect(container.querySelector('[class~="h-[60dvh]"]')).not.toBeNull();
    expect(container.querySelector("ul")).toBeNull();
  });

  it("map mode shows the load error with a retry button on top of the map", async () => {
    listVenuesNear.mockResolvedValue({ error: "boom" });
    renderDir("?view=map");
    const retry = await screen.findByRole("button", { name: "Thử lại" });
    expect(screen.getByTestId("map").parentElement?.contains(retry)).toBe(true);
  });

  it("map mode shows the empty state with expand radius on top of the map", async () => {
    listVenuesNear.mockResolvedValue({ venues: [] });
    renderDir("?view=map");
    const expand = await screen.findByRole("button", {
      name: viMessages.venues.expandRadius,
    });
    expect(screen.getByTestId("map").parentElement?.contains(expand)).toBe(
      true,
    );
  });

  it("desktop aside shows a hint until a pin is selected", async () => {
    mobile.value = false;
    renderDir("?view=map");
    expect(await screen.findByText("Bấm một ghim để xem sân")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "pin-1" }));
    await screen.findByText("Sân Một", { selector: "a" });
    await waitFor(() =>
      expect(screen.queryByText("Bấm một ghim để xem sân")).toBeNull(),
    );
  });
});

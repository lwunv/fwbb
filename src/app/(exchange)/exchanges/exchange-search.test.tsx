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
import type { ExchangeCard } from "@/lib/exchange/public-event";

const { listExchangesNear, mobile, locState, webgl } = vi.hoisted(() => ({
  listExchangesNear: vi.fn(),
  locState: { status: "ok" as "ok" | "asking" },
  mobile: { value: true },
  webgl: { ok: true },
}));

vi.mock("@/actions/exchange-read", () => ({ listExchangesNear }));
// LocationFallback importa geocodeAddress, kéo theo kết nối DB thật.
vi.mock("@/actions/venues", () => ({ geocodeAddress: vi.fn() }));
vi.mock("@/lib/map/webgl", () => ({ hasWebGL2: () => webgl.ok }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/use-is-mobile", async () => {
  const { useEffect, useState } = await import("react");
  return {
    useIsMobile: () => {
      const [v, setV] = useState(false);
      useEffect(() => {
        setV(mobile.value);
      }, []);
      return v;
    },
  };
});
vi.mock("@/components/venues/use-user-location", () => ({
  useUserLocation: () => ({
    status: locState.status,
    position: locState.status === "ok" ? { lat: 21.0, lng: 105.8 } : null,
    label: "Hà Nội",
    request: () => {},
    setManual: () => {},
  }),
}));
vi.mock("@/components/map/lazy-map-view", () => ({
  LazyMapView: (p: MapViewProps) => (
    <div data-testid="map" data-gestures={String(p.cooperativeGestures)}>
      {p.points.map((pt) => (
        <button
          key={`${pt.kind}:${pt.id}`}
          onClick={() => p.onPointClick?.(pt)}
        >
          pin-{pt.id}
        </button>
      ))}
    </div>
  ),
}));

import { ExchangeSearch } from "./exchange-search";

const card = (
  code: string,
  title: string,
  venueId: number,
  venueName: string,
): ExchangeCard => ({
  code,
  title,
  startAt: "2026-11-06T12:00:00.000Z",
  endAt: "2026-11-06T14:00:00.000Z",
  status: "open",
  skillMin: "tb",
  skillMax: null,
  slotsTotal: 24,
  fee: {
    kind: "split",
    estimate: { male: 100000, female: 80000 },
    current: { male: 100000, female: 80000 },
    minHeads: 12,
    currentHeads: 10,
    estimateIsCap: true,
  },
  counts: {
    approvedHeads: 10,
    pendingHeads: 2,
    waitlistHeads: 0,
    freeTotal: 12,
    freeFemaleOnly: 2,
  },
  venue: {
    id: venueId,
    name: venueName,
    lat: 21.0,
    lng: 105.8,
    areaLabel: null,
  },
  host: { name: "Lan", avatarUrl: null, avatarKey: null },
  distanceM: 2300,
});

function renderSearch(search = "", canOpenEvent = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="vi" messages={viMessages}>
        <NuqsTestingAdapter searchParams={search}>
          <ExchangeSearch canOpenEvent={canOpenEvent} />
        </NuqsTestingAdapter>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mobile.value = true;
  webgl.ok = true;
  locState.status = "ok";
  listExchangesNear.mockResolvedValue({
    events: [
      card("a1", "Giao lưu tối T6", 1, "Sân Một"),
      card("a2", "Sáng thứ bảy", 1, "Sân Một"),
      card("b1", "Chiều chủ nhật", 2, "Sân Hai"),
    ],
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ExchangeSearch", () => {
  it("list view does not render the map; list ↔ map calls listExchangesNear once", async () => {
    renderSearch();
    await screen.findByText("Giao lưu tối T6");
    expect(screen.queryByTestId("map")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Bản đồ" }));
    await screen.findByTestId("map");
    fireEvent.click(screen.getByRole("button", { name: "Danh sách" }));
    await screen.findByText("Giao lưu tối T6");
    expect(listExchangesNear).toHaveBeenCalledTimes(1);
  });

  it("drops an impossible date from the URL instead of sending it to the server", async () => {
    renderSearch("?d=2026-13-45");
    await screen.findByText("Giao lưu tối T6");
    expect(listExchangesNear.mock.calls[0][0].date).toBeUndefined();
    cleanup();
    listExchangesNear.mockClear();
    renderSearch("?d=2099-06-02");
    await screen.findByText("Giao lưu tối T6");
    expect(listExchangesNear.mock.calls[0][0]).toMatchObject({
      date: "2099-06-02",
    });
  });

  it("renders the card with VN time, distance, fee cap and slots", async () => {
    renderSearch();
    const link = (await screen.findByText("Giao lưu tối T6")).closest("a");
    expect(link?.getAttribute("href")).toBe("/exchanges/a1");
    const text = link?.textContent ?? "";
    expect(text).toContain("19:00");
    expect(text).toContain("~2,3 km");
    expect(text).toContain("tối đa 100K");
    expect(text).toContain("12/24");
    expect(text).toContain("còn 2 slot nữ");
  });

  it("radius change refetches and keeps previous pins while loading", async () => {
    renderSearch("?view=map");
    await screen.findByRole("button", { name: "pin-1" });
    let resolve!: (v: unknown) => void;
    listExchangesNear.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    fireEvent.click(screen.getByRole("button", { name: "10 km" }));
    expect(await screen.findByText("Đang tải buổi...")).toBeTruthy();
    expect(screen.getByRole("button", { name: "pin-1" })).toBeTruthy();
    expect(listExchangesNear).toHaveBeenCalledTimes(2);
    expect(listExchangesNear.mock.calls[1][0]).toMatchObject({ radiusKm: 10 });
    resolve({ events: [card("a1", "Giao lưu tối T6", 1, "Sân Một")] });
    await waitFor(() =>
      expect(screen.queryByText("Đang tải buổi...")).toBeNull(),
    );
  });

  it("tapping a pin opens a sheet with that venue's events", async () => {
    renderSearch("?view=map");
    fireEvent.click(await screen.findByRole("button", { name: "pin-1" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("data-side")).toBe("bottom");
    expect(dialog.textContent).toContain("Giao lưu tối T6");
    expect(dialog.textContent).toContain("Sáng thứ bảy");
    expect(dialog.textContent).not.toContain("Chiều chủ nhật");
  });

  it("tapping a pin on desktop shows a side panel without a dialog", async () => {
    mobile.value = false;
    renderSearch("?view=map");
    fireEvent.click(await screen.findByRole("button", { name: "pin-2" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await screen.findByText("Chiều chủ nhật")).toBeTruthy();
    expect(screen.queryByText("Sáng thứ bảy")).toBeNull();
  });

  it("empty result shows widen-radius on top of the map", async () => {
    listExchangesNear.mockResolvedValue({ events: [] });
    renderSearch("?view=map", true);
    const expand = await screen.findByRole("button", {
      name: viMessages.exchange.search.expandRadius,
    });
    expect(screen.getByTestId("map").parentElement?.contains(expand)).toBe(
      true,
    );
    expect(screen.getByText("Chưa có buổi quanh đây")).toBeTruthy();
    const open = screen.getAllByRole("link", { name: "Mở buổi" });
    expect(open[0].getAttribute("href")).toBe("/exchanges/new");
  });

  it("no WebGL disables the map button", async () => {
    webgl.ok = false;
    renderSearch("?view=map");
    await screen.findByText("Giao lưu tối T6");
    const toggle = screen.getByRole("button", { name: "Bản đồ" });
    expect(toggle.hasAttribute("disabled")).toBe(true);
    expect(screen.queryByTestId("map")).toBeNull();
    expect(
      screen
        .getByText(viMessages.exchange.search.mapUnsupported)
        .getAttribute("role"),
    ).toBe("status");
  });

  it("approved members get a floating open-event button, others do not", async () => {
    renderSearch("", true);
    await screen.findByText("Giao lưu tối T6");
    expect(
      screen
        .getAllByRole("link", { name: "Mở buổi" })
        .some((a) => a.getAttribute("href") === "/exchanges/new"),
    ).toBe(true);
    cleanup();
    renderSearch("", false);
    await screen.findByText("Giao lưu tối T6");
    expect(screen.queryByRole("link", { name: "Mở buổi" })).toBeNull();
  });

  it("filters from the url reach the query", async () => {
    renderSearch("?r=10&t=evening&skill=tb&slot=true&female=true&fee=100000");
    await screen.findByText("Giao lưu tối T6");
    expect(listExchangesNear.mock.calls[0][0]).toMatchObject({
      radiusKm: 10,
      timeOfDay: "evening",
      skill: "tb",
      hasSlot: true,
      hasFemaleSlot: true,
      maxFee: 100000,
    });
  });
});

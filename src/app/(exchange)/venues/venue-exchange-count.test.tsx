// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import viMessages from "@/i18n/messages/vi.json";

const { listVenuesNear, countUpcomingByVenue, listUpcomingAtVenue, state } =
  vi.hoisted(() => ({
    listVenuesNear: vi.fn(),
    countUpcomingByVenue: vi.fn(),
    listUpcomingAtVenue: vi.fn(),
    state: { flag: true },
  }));

vi.mock("@/actions/venues", () => ({
  listVenuesNear,
  geocodeAddress: vi.fn(),
  getPublicVenue: vi.fn(async (id: number) => ({
    id,
    name: "Sân Một",
    address: "addr",
    areaLabel: null,
    lat: 21,
    lng: 105.8,
    mapLink: null,
    courtCount: null,
    openHours: null,
    amenities: [],
    phone: null,
    refPricePerHour: null,
    photoLink: null,
  })),
}));
vi.mock("@/actions/exchange-read", () => ({
  countUpcomingByVenue,
  listUpcomingAtVenue,
}));
vi.mock("@/lib/exchange-flag", () => ({
  isExchangeEnabled: vi.fn(async () => state.flag),
}));
vi.mock("next-intl/server", () => ({
  getLocale: async () => "vi",
  getTranslations: async () => (k: string) => k,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/components/venues/venue-mini-map", () => ({
  VenueMiniMap: () => null,
}));
vi.mock("@/components/exchange/exchange-card", () => ({
  ExchangeCard: ({ event }: { event: { title: string } }) => (
    <div data-testid="ex-card">{event.title}</div>
  ),
}));
vi.mock("@/lib/use-is-mobile", () => ({ useIsMobile: () => true }));
vi.mock("@/components/venues/use-user-location", () => ({
  useUserLocation: () => ({
    status: "ok",
    position: { lat: 21.0, lng: 105.8 },
    label: "Hà Nội",
    request: () => {},
    setManual: () => {},
  }),
}));
vi.mock("@/components/map/lazy-map-view", () => ({ LazyMapView: () => null }));
// jsdom không có WebGL2; danh bạ ở đây là bố cục có bản đồ và ngăn kéo.
vi.mock("@/lib/map/webgl", () => ({
  hasWebGL2: () => true,
  useWebGL2Support: () => true,
}));

import { VenueDirectory } from "./venue-directory";
import VenueDetailPage from "./[id]/page";

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

async function renderDir(exchangeEnabled: boolean) {
  const r = render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <NextIntlClientProvider locale="vi" messages={viMessages}>
        <NuqsTestingAdapter hasMemory>
          <VenueDirectory
            canSuggest={false}
            exchangeEnabled={exchangeEnabled}
            loadExchangeCounts={countUpcomingByVenue}
          />
        </NuqsTestingAdapter>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  // Danh sách nằm trong ngăn kéo: chờ có dữ liệu rồi bấm tiêu đề để ngăn lên nấc giữa.
  await screen.findByText("Sân Một");
  fireEvent.click(screen.getByRole("button", { name: /sân quanh đây/ }));
  return r;
}

/** Chip bán kính mở bảng chọn; chọn một giá trị trong đó. */
async function pickRadius(km: number) {
  fireEvent.click(screen.getByRole("button", { name: /Bán kính \d+ km/ }));
  fireEvent.click(await screen.findByRole("radio", { name: `${km} km` }));
}

beforeEach(() => {
  state.flag = true;
  listVenuesNear.mockResolvedValue({
    venues: [venue(1, "Sân Một"), venue(2, "Sân Hai")],
  });
  countUpcomingByVenue.mockResolvedValue([[1, 3]]);
  listUpcomingAtVenue.mockResolvedValue([{ code: "abc", title: "Kèo tối" }]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("venue directory exchange counts", () => {
  it("flag off: venue search issues no settings or exchange query and cards show no count", async () => {
    await renderDir(false);
    expect(countUpcomingByVenue).not.toHaveBeenCalled();
    expect(screen.queryByText(/giao lưu sắp tới/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Có giao lưu/ })).toBeNull();
  });

  it("flag on: cards show the upcoming count and the has-exchange filter narrows the list", async () => {
    await renderDir(true);
    await screen.findByText("Sân Hai");
    await screen.findByText("3 giao lưu sắp tới");
    expect(countUpcomingByVenue).toHaveBeenCalledWith([1, 2]);
    fireEvent.click(screen.getByRole("button", { name: /Có giao lưu/ }));
    await waitFor(() => expect(screen.queryByText("Sân Hai")).toBeNull());
    expect(screen.getByText("Sân Một")).toBeTruthy();
  });
});

describe("venue directory exchange counts resilience", () => {
  it("counts error: keeps the unfiltered list, shows a status notice and retries", async () => {
    countUpcomingByVenue.mockRejectedValue(new Error("boom"));
    await renderDir(true);
    await screen.findByText("Sân Hai");
    fireEvent.click(screen.getByRole("button", { name: /Có giao lưu/ }));
    const notice = await screen.findByText(
      viMessages.venues.exchangeFilterUnavailable,
    );
    // Lời báo và nút "Thử lại" nằm ở hàng trạng thái nổi trên bản đồ.
    const overlay = screen.getByTestId("venues-overlay");
    expect(overlay.contains(notice)).toBe(true);
    expect(screen.getByText("Sân Một")).toBeTruthy();
    expect(screen.getByText("Sân Hai")).toBeTruthy();
    expect(screen.queryByText(/Chưa có sân nào/)).toBeNull();
    countUpcomingByVenue.mockResolvedValue([[1, 3]]);
    fireEvent.click(within(overlay).getByRole("button", { name: "Thử lại" }));
    await waitFor(() => expect(screen.queryByText("Sân Hai")).toBeNull());
    expect(screen.getByText("Sân Một")).toBeTruthy();
  });

  it("changing the venue list keeps the previous counts visible until the new ones arrive", async () => {
    await renderDir(true);
    await screen.findByText("3 giao lưu sắp tới");
    let resolveNext!: (v: [number, number][]) => void;
    countUpcomingByVenue.mockReturnValue(
      new Promise((r) => {
        resolveNext = r;
      }),
    );
    listVenuesNear.mockResolvedValue({
      venues: [venue(1, "Sân Một"), venue(2, "Sân Hai"), venue(3, "Sân Ba")],
    });
    await pickRadius(10);
    await screen.findByText("Sân Ba");
    await waitFor(() => expect(countUpcomingByVenue).toHaveBeenCalledTimes(2));
    expect(screen.getByText("3 giao lưu sắp tới")).toBeTruthy();
    resolveNext([[1, 4]]);
    await screen.findByText("4 giao lưu sắp tới");
  });
});

describe("venue page exchanges", () => {
  async function renderPage() {
    const ui = await VenueDetailPage({ params: Promise.resolve({ id: "1" }) });
    return render(
      <NextIntlClientProvider locale="vi" messages={viMessages}>
        {ui}
      </NextIntlClientProvider>,
    );
  }

  it("venue page lists upcoming exchanges only when the flag is on", async () => {
    await renderPage();
    expect(await screen.findByText("Kèo tối")).toBeTruthy();
    cleanup();
    listUpcomingAtVenue.mockClear();
    state.flag = false;
    await renderPage();
    expect(screen.queryByText("Kèo tối")).toBeNull();
    expect(listUpcomingAtVenue).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import viMessages from "@/i18n/messages/vi.json";
import { VenueQuickView } from "./venue-quick-view";
import type { PublicVenue } from "@/lib/public-venue";
import type { ExchangeCard } from "@/lib/exchange/public-event";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const shareMock = vi.hoisted(() => ({ shareOrCopy: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/lib/share-link", () => shareMock);

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const venue: PublicVenue = {
  id: 7,
  name: "Sân Cầu Giấy",
  address: "1 Trần Thái Tông",
  areaLabel: null,
  lat: 21.03,
  lng: 105.85,
  mapLink: null,
  courtCount: 6,
  openHours: "5:00 - 23:00",
  amenities: ["parking", "shower"],
  phone: "0912 345-678",
  refPricePerHour: 120000,
  photoLink: null,
};
// 10:00 giờ Việt Nam
const now = new Date("2026-11-09T03:00:00.000Z");

function ev(
  code: string,
  over: Partial<ExchangeCard["counts"]> = {},
): ExchangeCard {
  return {
    code,
    title: "Giao lưu",
    startAt: "2026-11-10T12:00:00.000Z",
    endAt: "2026-11-10T14:00:00.000Z",
    status: "open",
    skillMin: null,
    skillMax: null,
    slotsTotal: 12,
    fee: { kind: "fixed", male: 80000, female: 80000 },
    counts: {
      approvedHeads: 8,
      pendingHeads: 0,
      waitlistHeads: 0,
      freeTotal: 4,
      freeFemaleOnly: 0,
      ...over,
    },
    venue: { id: 7, name: "Sân", lat: 0, lng: 0, areaLabel: null },
    host: { name: "H", avatarUrl: null, avatarKey: null },
    distanceM: null,
  } as ExchangeCard;
}

function renderQv(
  p: Partial<React.ComponentProps<typeof VenueQuickView>> = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="vi" messages={viMessages}>
        <VenueQuickView
          venue={venue}
          locale="vi"
          exchangeCount={0}
          now={now}
          onClose={() => {}}
          closeLabel="close"
          {...p}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("VenueQuickView", () => {
  it("quick view shows hours with status, price, visible amenity labels, directions in a new tab and a tel link with digits only", () => {
    renderQv({ venue: { ...venue, distanceM: 2345 } });
    expect(screen.getByText("2,3 km")).toBeTruthy();
    expect(screen.getByText("Đang mở (5:00 - 23:00)")).toBeTruthy();
    expect(screen.getByText("120.000đ/giờ")).toBeTruthy();
    expect(screen.getByText("Gửi xe")).toBeTruthy();
    expect(screen.getByText("Phòng tắm")).toBeTruthy();
    const dir = screen.getByRole("link", { name: "Chỉ đường" });
    expect(dir.getAttribute("target")).toBe("_blank");
    expect(dir.getAttribute("href")).toContain("destination=21.03,105.85");
    expect(screen.getByRole("link", { name: "Gọi" }).getAttribute("href")).toBe(
      "tel:0912345678",
    );
    expect(
      screen.getByRole("link", { name: "Xem chi tiết" }).getAttribute("href"),
    ).toBe("/venues/7");
  });

  it("no phone hides the call button", () => {
    renderQv({ venue: { ...venue, phone: null } });
    expect(screen.queryByRole("link", { name: "Gọi" })).toBeNull();
  });

  it("count 0 or no loader never calls loadUpcoming", () => {
    const load = vi.fn().mockResolvedValue([]);
    renderQv({ exchangeCount: 0, loadUpcoming: load });
    cleanup();
    renderQv({ exchangeCount: 2 });
    cleanup();
    renderQv({ exchangeCount: undefined, loadUpcoming: load });
    expect(load).not.toHaveBeenCalled();
  });

  it("count 2 calls loadUpcoming once and lists at most 3 exchanges with time, fee and Còn N chỗ", async () => {
    const load = vi
      .fn()
      .mockResolvedValue([ev("a"), ev("b"), ev("c"), ev("d")]);
    renderQv({ exchangeCount: 2, loadUpcoming: load });
    expect(screen.getByTestId("upcoming-skeleton")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getAllByText(/Còn 4 chỗ/)).toHaveLength(3),
    );
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(7);
    expect(screen.getAllByText(/19:00-21:00/)).toHaveLength(3);
    expect(screen.getAllByText(/80K/)).toHaveLength(3);
    const links = screen
      .getAllByRole("link")
      .map((l) => l.getAttribute("href"))
      .filter((h) => h?.startsWith("/exchanges/"));
    expect(links).toEqual(["/exchanges/a", "/exchanges/b", "/exchanges/c"]);
  });

  it("female-only free slots add the female note", async () => {
    const load = vi
      .fn()
      .mockResolvedValue([ev("a", { freeTotal: 3, freeFemaleOnly: 2 })]);
    renderQv({ exchangeCount: 1, loadUpcoming: load });
    await waitFor(() => expect(screen.getByText(/còn 2 slot nữ/)).toBeTruthy());
    expect(screen.getByText(/Còn 3 chỗ/)).toBeTruthy();
  });

  it("loader error shows the message and retry calls it again", async () => {
    const load = vi.fn().mockRejectedValue(new Error("x"));
    renderQv({ exchangeCount: 1, loadUpcoming: load });
    await waitFor(() =>
      expect(screen.getByText("Không tải được giao lưu sắp tới.")).toBeTruthy(),
    );
    expect(load).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it("share copied shows the toast; cancelled shows nothing", async () => {
    renderQv();
    shareMock.shareOrCopy.mockResolvedValueOnce("copied");
    fireEvent.click(screen.getByRole("button", { name: "Chia sẻ" }));
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith("Đã chép link"),
    );
    expect(shareMock.shareOrCopy).toHaveBeenCalledWith({
      title: "Sân Cầu Giấy",
      url: `${window.location.origin}/venues/7`,
    });
    shareMock.shareOrCopy.mockResolvedValueOnce("cancelled");
    fireEvent.click(screen.getByRole("button", { name: "Chia sẻ" }));
    await waitFor(() => expect(shareMock.shareOrCopy).toHaveBeenCalledTimes(2));
    expect(toastMock.success).toHaveBeenCalledTimes(1);
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("close button calls onClose with the right label for close and back", () => {
    const onClose = vi.fn();
    renderQv({ onClose, closeLabel: "close" });
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    cleanup();
    renderQv({ onClose, closeLabel: "back" });
    fireEvent.click(screen.getByRole("button", { name: "Danh sách sân" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

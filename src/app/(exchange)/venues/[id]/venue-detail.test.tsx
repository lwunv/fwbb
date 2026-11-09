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
import viMessages from "@/i18n/messages/vi.json";
import type { PublicVenue } from "@/lib/public-venue";
import type { ExchangeCard } from "@/lib/exchange/public-event";

const mocks = vi.hoisted(() => ({
  getPublicVenue: vi.fn(),
  listUpcomingAtVenue: vi.fn(),
  isExchangeEnabled: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/actions/venues", () => ({ getPublicVenue: mocks.getPublicVenue }));
vi.mock("@/actions/exchange-read", () => ({
  listUpcomingAtVenue: mocks.listUpcomingAtVenue,
}));
vi.mock("@/lib/exchange-flag", () => ({
  isExchangeEnabled: mocks.isExchangeEnabled,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));
// Bản đồ thật cần WebGL; ở đây chỉ cần biết nó nằm ở đầu trang.
vi.mock("@/components/venues/venue-mini-map", () => ({
  VenueMiniMap: () => <div data-testid="venue-mini-map" />,
}));
// Phần server dịch bằng đúng vi.json để so được chữ thật ("Đang mở", "6 sân").
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { default: messages } = await import("@/i18n/messages/vi.json");
  return {
    getLocale: async () => "vi",
    getTranslations: async (namespace: "venues") =>
      createTranslator({ locale: "vi", messages, namespace }),
  };
});

import VenueDetailPage from "./page";

const venue: PublicVenue = {
  id: 7,
  name: "Sân Cầu Giấy",
  address: "1 Trần Thái Tông, Dịch Vọng Hậu",
  areaLabel: "Cầu Giấy, Hà Nội",
  lat: 21.03,
  lng: 105.85,
  mapLink: null,
  courtCount: 6,
  openHours: "5:00 - 23:00",
  amenities: ["parking", "shower"],
  phone: "0912 345-678",
  refPricePerHour: 120000,
  photoLink: "https://www.facebook.com/sancaugiay",
};

function ev(code: string, title: string): ExchangeCard {
  return {
    code,
    title,
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
    },
    venue: {
      id: 7,
      name: "Sân Cầu Giấy",
      lat: 21.03,
      lng: 105.85,
      areaLabel: null,
    },
    host: { name: "Hà", avatarUrl: null, avatarKey: null },
    distanceM: null,
  } as ExchangeCard;
}

async function renderPage(over: Partial<PublicVenue> = {}) {
  mocks.getPublicVenue.mockResolvedValue({ ...venue, ...over });
  const ui = await VenueDetailPage({ params: Promise.resolve({ id: "7" }) });
  return render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

/** Cỡ chữ có hiệu lực: lớp `text-<cỡ>` gần nhất tính từ phần tử lên gốc. */
function fontSizeOf(el: HTMLElement): string | null {
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    const m = /(?:^|\s)(text-(?:xs|sm|base|lg|[2-9]?xl))(?=\s|$)/.exec(
      n.getAttribute("class") ?? "",
    );
    if (m) return m[1];
  }
  return null;
}

const hasClass = (el: Element, name: string) =>
  (el.getAttribute("class") ?? "").split(/\s+/).includes(name);

beforeEach(() => {
  mocks.isExchangeEnabled.mockResolvedValue(true);
  mocks.listUpcomingAtVenue.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("venue detail page", () => {
  it("shows address, hours with Đang mở at 10:00 VN, court count, price, a tel link and labelled amenities, all values text-base", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-09T03:00:00Z")); // 10:00 giờ Việt Nam
    await renderPage();

    const title = screen.getByRole("heading", {
      level: 1,
      name: "Sân Cầu Giấy",
    });
    expect(screen.getByText("Cầu Giấy, Hà Nội")).toBeTruthy();
    // Bản đồ nhỏ đứng trên tên sân.
    expect(
      screen.getByTestId("venue-mini-map").compareDocumentPosition(title) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Danh sách sân" }).getAttribute("href"),
    ).toBe("/venues");

    for (const label of [
      "Địa chỉ",
      "Giờ mở cửa",
      "Số sân",
      "Giá thuê tham khảo mỗi giờ",
      "Số điện thoại sân",
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    for (const value of [
      "1 Trần Thái Tông, Dịch Vọng Hậu",
      "Đang mở (5:00 - 23:00)",
      "6 sân",
      "120.000đ",
      "0912 345-678",
      "Gửi xe",
      "Phòng tắm",
    ]) {
      expect(fontSizeOf(screen.getByText(value))).toBe("text-base");
    }

    const tel = screen.getByRole("link", { name: /0912 345-678/ });
    expect(tel.getAttribute("href")).toBe("tel:0912345678");
    expect(screen.getByRole("heading", { name: "Tiện ích" })).toBeTruthy();

    const photo = screen.getByRole("link", { name: "Link ảnh hoặc fanpage" });
    expect(photo.getAttribute("href")).toBe(venue.photoLink);
    expect(photo.getAttribute("target")).toBe("_blank");
    expect(photo.getAttribute("rel")).toContain("nofollow");
    expect(screen.queryByText(/Đề xuất sửa/)).toBeNull();
  });

  it("unparseable hours show Chưa rõ giờ", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-09T03:00:00Z")); // 10:00, trong khung 5-22
    await renderPage({ openHours: "T2-T6 5:00-22:00" });
    // Không đoán trạng thái, nhưng vẫn cho xem chữ gốc chủ sân đã gõ.
    expect(screen.getByText("Chưa rõ giờ (T2-T6 5:00-22:00)")).toBeTruthy();
    expect(screen.queryByText(/Đang mở|Đã đóng/)).toBeNull();
  });

  it("no phone hides both call buttons", async () => {
    await renderPage();
    const calls = screen.getAllByRole("link", { name: "Gọi" });
    // Một nút ở hàng nút (md:), một ở thanh dính đáy (điện thoại).
    expect(calls).toHaveLength(2);
    for (const a of calls)
      expect(a.getAttribute("href")).toBe("tel:0912345678");

    cleanup();
    await renderPage({ phone: null });
    expect(screen.queryAllByRole("link", { name: "Gọi" })).toHaveLength(0);
    expect(document.querySelector('a[href^="tel:"]')).toBeNull();
  });

  it("shows the reviews coming soon block", async () => {
    await renderPage();
    const block = document.querySelector('[data-section="venue-reviews"]');
    expect(block).not.toBeNull();
    const reviews = within(block as HTMLElement);
    expect(reviews.getByRole("heading", { name: "Đánh giá sân" })).toBeTruthy();
    expect(reviews.getByText("Đánh giá sân: sắp có")).toBeTruthy();

    // Không phụ thuộc cờ giao lưu.
    cleanup();
    mocks.isExchangeEnabled.mockResolvedValue(false);
    await renderPage();
    expect(
      document.querySelector('[data-section="venue-reviews"]'),
    ).not.toBeNull();
    expect(
      screen.queryByRole("region", { name: "Giao lưu sắp tới" }),
    ).toBeNull();
  });

  it("exchange cards link to /exchanges/{code}", async () => {
    mocks.listUpcomingAtVenue.mockResolvedValue([
      ev("abc", "Kèo tối thứ Ba"),
      ev("xyz", "Kèo sáng Chủ nhật"),
    ]);
    await renderPage();
    expect(mocks.listUpcomingAtVenue).toHaveBeenCalledWith(7);
    const section = screen.getByRole("region", { name: "Giao lưu sắp tới" });
    expect(
      within(section)
        .getAllByRole("link")
        .map((a) => a.getAttribute("href")),
    ).toEqual(["/exchanges/abc", "/exchanges/xyz"]);
    expect(within(section).getByText("Kèo tối thứ Ba")).toBeTruthy();

    cleanup();
    mocks.listUpcomingAtVenue.mockResolvedValue([]);
    await renderPage();
    expect(
      screen.getByText("Chưa có buổi giao lưu nào sắp tới ở sân này."),
    ).toBeTruthy();
  });

  it("share button copies the /venues/{id} link when navigator.share is missing", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    expect("share" in navigator).toBe(false);
    await renderPage();

    const shares = screen.getAllByRole("button", { name: "Chia sẻ" });
    expect(shares).toHaveLength(2);
    fireEvent.click(shares[1]);
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith("Đã chép link"),
    );
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/venues/7`,
    );
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("phone bar sticks to the bottom with a wide directions button, 44px call and share icons and safe-area padding", async () => {
    await renderPage();
    const bar = screen.getByTestId("venue-action-bar");
    expect(hasClass(bar, "fixed")).toBe(true);
    expect(hasClass(bar, "md:hidden")).toBe(true);
    expect(bar.getAttribute("class")).toContain("env(safe-area-inset-bottom");

    const dir = within(bar).getByRole("link", { name: "Chỉ đường" });
    expect(dir.getAttribute("href")).toContain("destination=21.03,105.85");
    expect(dir.getAttribute("target")).toBe("_blank");
    expect(hasClass(dir, "flex-1")).toBe(true);
    for (const el of [
      within(bar).getByRole("link", { name: "Gọi" }),
      within(bar).getByRole("button", { name: "Chia sẻ" }),
    ]) {
      expect(hasClass(el, "size-11")).toBe(true);
    }

    // Từ md: trở lên là hàng nút có chữ, nằm trong trang.
    const row = screen.getByTestId("venue-actions");
    expect(hasClass(row, "hidden")).toBe(true);
    expect(hasClass(row, "md:flex")).toBe(true);
    expect(within(row).getByRole("link", { name: "Chỉ đường" })).toBeTruthy();
    expect(within(row).getByRole("link", { name: "Gọi" })).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Chia sẻ" })).toBeTruthy();
  });

  it("missing details hide their rows instead of showing blanks", async () => {
    await renderPage({
      address: null,
      areaLabel: null,
      openHours: "   ",
      courtCount: null,
      refPricePerHour: null,
      phone: "không có",
      amenities: [],
      photoLink: null,
    });
    for (const label of [
      "Địa chỉ",
      "Giờ mở cửa",
      "Số sân",
      "Giá thuê tham khảo mỗi giờ",
      "Số điện thoại sân",
      "Tiện ích",
      "Link ảnh hoặc fanpage",
    ]) {
      expect(screen.queryByText(label)).toBeNull();
    }
    expect(document.querySelector('a[href^="tel:"]')).toBeNull();
    expect(
      screen.getByRole("heading", { level: 1, name: "Sân Cầu Giấy" }),
    ).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Chỉ đường" })).toHaveLength(2);
  });
});

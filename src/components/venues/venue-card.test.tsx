// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";
import { VenueCard } from "./venue-card";
import type { PublicVenue } from "@/lib/public-venue";

afterEach(cleanup);

const base: PublicVenue = {
  id: 7,
  name: "Sân Cầu Giấy",
  address: "1 Trần Thái Tông",
  areaLabel: null,
  lat: 21.03,
  lng: 105.85,
  mapLink: null,
  courtCount: null,
  openHours: null,
  amenities: [],
  phone: null,
  refPricePerHour: null,
  photoLink: null,
};

function renderCard(venue: PublicVenue & { distanceM?: number }) {
  return render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <VenueCard venue={venue} locale="vi" />
    </NextIntlClientProvider>,
  );
}

describe("VenueCard", () => {
  it("hiện khoảng cách, số sân, giá tham khảo, link chỉ đường mở tab mới", () => {
    renderCard({
      ...base,
      distanceM: 2345,
      courtCount: 6,
      refPricePerHour: 120000,
    });
    expect(screen.getByText("2,3 km")).toBeTruthy();
    expect(screen.getByText("6 sân")).toBeTruthy();
    expect(screen.getByText("120.000đ/giờ")).toBeTruthy();
    const a = screen.getByRole("link", { name: /Chỉ đường tới/ });
    expect(a.getAttribute("href")).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=21.03,105.85",
    );
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
  });

  it("không có giá → không hiện dòng giá; không có khoảng cách → không hiện", () => {
    renderCard(base);
    expect(screen.queryByText(/\/giờ/)).toBeNull();
    expect(screen.queryByText(/km|\d+ m$/)).toBeNull();
  });

  it("tên sân là link tới trang chi tiết", () => {
    renderCard(base);
    expect(
      screen.getByRole("link", { name: "Sân Cầu Giấy" }).getAttribute("href"),
    ).toBe("/venues/7");
  });

  it("hiện tiện ích theo bản dịch", () => {
    renderCard({ ...base, amenities: ["parking", "air_con"] });
    expect(screen.getByText("Gửi xe")).toBeTruthy();
    expect(screen.getByText("Điều hoà")).toBeTruthy();
  });
});

describe("VenueCard upcoming exchanges", () => {
  function renderWithCount(count?: number) {
    return render(
      <NextIntlClientProvider locale="vi" messages={viMessages}>
        <VenueCard venue={base} locale="vi" upcomingExchangeCount={count} />
      </NextIntlClientProvider>,
    );
  }

  it("shows the upcoming exchange count when positive", () => {
    renderWithCount(2);
    expect(screen.getByText("2 giao lưu sắp tới")).toBeTruthy();
  });

  it("renders nothing extra when the count is undefined or zero", () => {
    renderWithCount(undefined);
    expect(screen.queryByText(/giao lưu sắp tới/)).toBeNull();
    cleanup();
    renderWithCount(0);
    expect(screen.queryByText(/giao lưu sắp tới/)).toBeNull();
  });
});

describe("VenueCard compact", () => {
  // 03:00 UTC = 10:00 giờ Việt Nam
  const now = new Date("2026-11-09T03:00:00Z");
  function renderAt(
    venue: PublicVenue,
    props: { onSelect?: () => void; selected?: boolean } = {},
  ) {
    return render(
      <NextIntlClientProvider locale="vi" messages={viMessages}>
        <VenueCard venue={venue} locale="vi" now={now} {...props} />
      </NextIntlClientProvider>,
    );
  }

  it('shows Đang mở with the raw hours at 10:00 VN for "5:00 - 23:00"', () => {
    renderAt({ ...base, openHours: "5:00 - 23:00" });
    expect(screen.getByText(/Đang mở \(5:00 - 23:00\)/)).toBeTruthy();
  });

  it('shows Chưa rõ giờ for "Sáng 5-9"', () => {
    renderAt({ ...base, openHours: "Sáng 5-9" });
    expect(screen.getByText(/Chưa rõ giờ/)).toBeTruthy();
    expect(screen.queryByText(/Đang mở/)).toBeNull();
  });

  it("no hours part when openHours is null", () => {
    renderAt(base);
    expect(screen.queryByText(/Chưa rõ giờ|Đang mở|Đã đóng/)).toBeNull();
  });

  it("with onSelect, tapping the card selects and tapping directions does not", () => {
    const onSelect = vi.fn();
    renderAt(base, { onSelect });
    fireEvent.click(screen.getByRole("button", { name: "Sân Cầu Giấy" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("link", { name: /Chỉ đường tới/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("with onSelect there is no anchor inside a button", () => {
    const { container } = renderAt(base, { onSelect: () => {} });
    expect(container.querySelector("button a")).toBeNull();
    expect(container.querySelector("a button")).toBeNull();
  });

  it("directions control has class size-11", () => {
    renderAt(base);
    expect(
      screen
        .getByRole("link", { name: /Chỉ đường tới/ })
        .classList.contains("size-11"),
    ).toBe(true);
  });
});

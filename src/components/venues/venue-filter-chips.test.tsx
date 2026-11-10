// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";
import { VenueFilterChips } from "./venue-filter-chips";
import type { VenueAmenity } from "@/lib/venue-amenities";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
});
afterEach(cleanup);

function setup(
  over: Partial<React.ComponentProps<typeof VenueFilterChips>> = {},
) {
  const props = {
    radius: 5 as const,
    onRadius: vi.fn(),
    amenities: [] as VenueAmenity[],
    onAmenities: vi.fn(),
    exchange: false,
    onExchange: vi.fn(),
    showExchange: true,
    openNow: false,
    onOpenNow: vi.fn(),
    ...over,
  };
  const ui = (p: typeof props) => (
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <VenueFilterChips {...p} />
    </NextIntlClientProvider>
  );
  const r = render(ui(props));
  return {
    props,
    rerender: (o: Partial<typeof props>) => r.rerender(ui({ ...props, ...o })),
  };
}

describe("VenueFilterChips", () => {
  it("hides the exchange chip when showExchange is false", () => {
    setup({ showExchange: false });
    expect(screen.queryByRole("button", { name: "Có giao lưu" })).toBeNull();
    cleanup();
    setup({ showExchange: true });
    expect(screen.getByRole("button", { name: "Có giao lưu" })).toBeTruthy();
  });

  it('radius chip shows "Bán kính 5 km"; picking 10 calls onRadius(10) and closes', async () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Bán kính 5 km/ }));
    const radio = await screen.findByRole("radio", { name: /10 km/ });
    fireEvent.click(radio);
    expect(props.onRadius).toHaveBeenCalledWith(10);
    await vi.waitFor(() => expect(screen.queryByRole("radio")).toBeNull());
  });

  it("amenities sheet toggles parking and the chip shows the count", async () => {
    const { props, rerender } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Tiện ích" }));
    fireEvent.click(await screen.findByRole("button", { name: /Gửi xe/ }));
    expect(props.onAmenities).toHaveBeenCalledWith(["parking"]);
    // Hộp thoại đang mở thì phần còn lại bị aria-hidden, nên đóng trước khi đọc chip.
    fireEvent.click(screen.getByRole("button", { name: "Xong" }));
    rerender({ amenities: ["parking"] });
    expect(
      screen
        .getByRole("button", { name: "Tiện ích (1)" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("open now chip toggles with aria-pressed", () => {
    const { props, rerender } = setup();
    const chip = screen.getByRole("button", { name: "Đang mở cửa" });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(chip);
    expect(props.onOpenNow).toHaveBeenCalledWith(true);
    rerender({ openNow: true });
    expect(
      screen
        .getByRole("button", { name: "Đang mở cửa" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("every chip has min-h-11", () => {
    setup();
    const chips = screen.getAllByRole("button");
    expect(chips.length).toBe(4);
    for (const c of chips) expect(c.className).toContain("min-h-11");
  });
});

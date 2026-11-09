// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import viMessages from "@/i18n/messages/vi.json";
import { VenueSearchBar } from "./venue-search-bar";
import type { PublicVenue } from "@/lib/public-venue";

const geocodeMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/actions/venues", () => ({ geocodeAddress: geocodeMock }));
vi.mock("sonner", () => ({ toast: toastMock }));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

function venue(id: number, name: string): PublicVenue & { distanceM?: number } {
  return {
    id,
    name,
    address: null,
    areaLabel: null,
    lat: 21.03,
    lng: 105.85,
    mapLink: null,
    courtCount: 4,
    openHours: null,
    amenities: [],
    phone: null,
    refPricePerHour: null,
    photoLink: null,
  };
}

const venues = [
  venue(1, "Sân cầu lông Cầu Giấy"),
  venue(2, "Sân Thanh Xuân"),
  venue(3, "Cầu Giấy Arena"),
];

function setup(
  over: Partial<React.ComponentProps<typeof VenueSearchBar>> = {},
) {
  const props = {
    venues,
    locale: "vi" as const,
    onPickVenue: vi.fn(),
    onPlace: vi.fn(),
    onLocate: vi.fn(),
    locating: false,
    onFocusChange: vi.fn(),
    ...over,
  };
  const qc = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="vi" messages={viMessages}>
        <VenueSearchBar {...props} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  const input = screen.getByRole("combobox") as HTMLInputElement;
  return { props, input };
}

function type(input: HTMLInputElement, value: string) {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
}
const enter = (input: HTMLInputElement) =>
  fireEvent.keyDown(input, { key: "Enter" });

describe("VenueSearchBar", () => {
  it('typing "cau giay" lists "Sân cầu lông Cầu Giấy" without calling geocode', () => {
    const { input } = setup();
    type(input, "cau giay");
    expect(
      screen.getByRole("option", { name: /Sân cầu lông Cầu Giấy/ }),
    ).toBeTruthy();
    expect(geocodeMock).not.toHaveBeenCalled();
  });

  it('Enter "Cầu Giấy" with that venue loaded calls geocode, not the venue', async () => {
    geocodeMock.mockResolvedValue({
      lat: 21.03,
      lng: 105.79,
      label: "Cầu Giấy",
    });
    const { input, props } = setup();
    type(input, "Cầu Giấy");
    enter(input);
    await waitFor(() => expect(geocodeMock).toHaveBeenCalledTimes(1));
    expect(geocodeMock.mock.calls[0][0]).toBe("Cầu Giấy");
    expect(props.onPickVenue).not.toHaveBeenCalled();
    await waitFor(() => expect(props.onPlace).toHaveBeenCalled());
  });

  it('Enter "Sân cầu lông Cầu Giấy" selects the venue', () => {
    const { input, props } = setup();
    type(input, "Sân cầu lông Cầu Giấy");
    enter(input);
    expect(props.onPickVenue).toHaveBeenCalledWith(1);
    expect(geocodeMock).not.toHaveBeenCalled();
  });

  it("arrow down then Enter picks the highlighted suggestion", () => {
    const { input, props } = setup();
    type(input, "cau giay");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBeTruthy();
    enter(input);
    expect(props.onPickVenue).toHaveBeenCalledTimes(1);
    expect(geocodeMock).not.toHaveBeenCalled();
  });

  it("tapping a suggestion picks it", () => {
    const { input, props } = setup();
    type(input, "thanh");
    fireEvent.click(screen.getByRole("option", { name: /Sân Thanh Xuân/ }));
    expect(props.onPickVenue).toHaveBeenCalledWith(2);
  });

  it("the last option searches the typed place even when venues match", async () => {
    geocodeMock.mockResolvedValue({
      lat: 21.03,
      lng: 105.79,
      label: "Cầu Giấy",
    });
    const { input, props } = setup();
    type(input, "cau giay");
    const options = screen.getAllByRole("option");
    fireEvent.click(options[options.length - 1]);
    await waitFor(() => expect(geocodeMock).toHaveBeenCalledTimes(1));
    expect(props.onPickVenue).not.toHaveBeenCalled();
  });

  it("a geocode result inside Trường Sa is labelled with the Vietnamese name", async () => {
    geocodeMock.mockResolvedValue({
      lat: 10,
      lng: 114,
      label: "Spratly Islands",
    });
    const { input, props } = setup();
    type(input, "spratly");
    enter(input);
    await waitFor(() => expect(props.onPlace).toHaveBeenCalled());
    const [p, label] = (props.onPlace as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(p).toEqual({ lat: 10, lng: 114 });
    expect(label).toMatch(/Trường Sa/);
  });

  it("searching the same text twice calls geocode once", async () => {
    geocodeMock.mockResolvedValue({
      lat: 21.03,
      lng: 105.79,
      label: "Cầu Giấy",
    });
    const { input, props } = setup();
    type(input, "Cầu Giấy");
    enter(input);
    await waitFor(() => expect(props.onPlace).toHaveBeenCalledTimes(1));
    type(input, "  cau GIAY ");
    enter(input);
    await waitFor(() => expect(props.onPlace).toHaveBeenCalledTimes(2));
    expect(geocodeMock).toHaveBeenCalledTimes(1);
  });

  it("server error text shows under the box with role alert and no toast, and is not cached", async () => {
    geocodeMock
      .mockResolvedValueOnce({ error: "Quá nhiều yêu cầu" })
      .mockResolvedValueOnce({ lat: 21, lng: 105, label: "X" });
    const { input, props } = setup();
    type(input, "abc xyz");
    enter(input);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Quá nhiều yêu cầu");
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(props.onPlace).not.toHaveBeenCalled();
    enter(input);
    await waitFor(() => expect(geocodeMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(props.onPlace).toHaveBeenCalled());
  });

  it("a network failure shows searchFailed", async () => {
    geocodeMock.mockRejectedValue(new Error("boom"));
    const { input } = setup();
    type(input, "abc xyz");
    enter(input);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(viMessages.venues.searchFailed);
  });

  it("Enter while pending does not call geocode again", async () => {
    let resolve: (v: unknown) => void = () => {};
    geocodeMock.mockImplementation(() => new Promise((r) => (resolve = r)));
    const { input, props } = setup();
    type(input, "abc xyz");
    enter(input);
    await waitFor(() => expect(geocodeMock).toHaveBeenCalledTimes(1));
    enter(input);
    enter(input);
    expect(geocodeMock).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ lat: 21, lng: 105, label: "X" }));
    await waitFor(() => expect(props.onPlace).toHaveBeenCalledTimes(1));
  });

  it("Enter on an empty box does nothing", () => {
    const { input, props } = setup();
    fireEvent.focus(input);
    enter(input);
    type(input, "   ");
    enter(input);
    expect(geocodeMock).not.toHaveBeenCalled();
    expect(props.onPickVenue).not.toHaveBeenCalled();
    expect(props.onPlace).not.toHaveBeenCalled();
  });

  it("typing clears the error", async () => {
    geocodeMock.mockResolvedValue({ error: "Không tìm thấy" });
    const { input } = setup();
    type(input, "abc xyz");
    enter(input);
    await screen.findByRole("alert");
    fireEvent.change(input, { target: { value: "abc xyzw" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("focus and blur call onFocusChange", () => {
    const { input, props } = setup();
    fireEvent.focus(input);
    expect(props.onFocusChange).toHaveBeenLastCalledWith(true);
    fireEvent.blur(input);
    expect(props.onFocusChange).toHaveBeenLastCalledWith(false);
  });

  it("locate button calls onLocate and has an accessible name", () => {
    const { props } = setup();
    fireEvent.click(
      screen.getByRole("button", { name: viMessages.venues.useMyLocation }),
    );
    expect(props.onLocate).toHaveBeenCalledTimes(1);
  });

  it("uses text-base and 44px targets on the input", () => {
    const { input } = setup();
    expect(input.className).toContain("text-base");
    expect(input.className).toContain("min-h-11");
    expect(input.getAttribute("maxlength")).toBe("200");
  });
});

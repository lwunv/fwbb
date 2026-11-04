// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";
import type { MapViewProps } from "@/components/map/map-view";

const { captured } = vi.hoisted(() => ({
  captured: { props: null as null | MapViewProps },
}));

vi.mock("@/components/map/lazy-map-view", () => ({
  LazyMapView: (props: MapViewProps) => {
    captured.props = props;
    return <div data-testid="lazy-map" />;
  },
}));
vi.mock("@/lib/use-is-mobile", () => ({ useIsMobile: () => false }));

import { VenueForm, type VenueFormValues } from "./venue-form";

afterEach(() => {
  cleanup();
  captured.props = null;
});

function renderForm(
  defaultValues: Parameters<typeof VenueForm>[0]["defaultValues"] = {
    name: "Sân A",
  },
) {
  const onSubmit = vi.fn<(v: VenueFormValues) => Promise<void>>(async () => {});
  render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <VenueForm
        defaultValues={defaultValues}
        submitLabel="Lưu"
        onSubmit={onSubmit}
      />
    </NextIntlClientProvider>,
  );
  return onSubmit;
}

describe("VenueForm map picker", () => {
  it("picking writes lat/lng with 6 decimals into the form and reveals the coordinate fields", async () => {
    const onSubmit = renderForm();
    expect(screen.queryByLabelText("Vĩ độ")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Chọn trên bản đồ" }));
    await screen.findByTestId("lazy-map");
    act(() =>
      captured.props?.onMoveEnd?.({ lat: 21.0285123456, lng: 105.8542987654 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Dùng vị trí này" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Vĩ độ")).toHaveProperty(
        "value",
        "21.028512",
      ),
    );
    expect(screen.getByLabelText("Kinh độ")).toHaveProperty(
      "value",
      "105.854299",
    );
    expect(screen.queryByTestId("lazy-map")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const v = onSubmit.mock.calls[0][0];
    expect([v.lat, v.lng]).toEqual([21.028512, 105.854299]);
  });

  it("starts the map at the coordinates already in the form", async () => {
    renderForm({ name: "Sân B", lat: 21.03, lng: 105.85 });
    fireEvent.click(screen.getByRole("button", { name: "Chọn trên bản đồ" }));
    await screen.findByTestId("lazy-map");
    expect(captured.props?.center).toEqual({ lat: 21.03, lng: 105.85 });
  });

  it("with no coordinates the map starts at Hanoi", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Chọn trên bản đồ" }));
    await screen.findByTestId("lazy-map");
    expect(captured.props?.center).toEqual({ lat: 21.0285, lng: 105.8542 });
  });

  it("cancel leaves the form unchanged", async () => {
    renderForm({ name: "Sân B", lat: 21.03, lng: 105.85 });
    fireEvent.click(screen.getByRole("button", { name: "Chọn trên bản đồ" }));
    await screen.findByTestId("lazy-map");
    act(() => captured.props?.onMoveEnd?.({ lat: 10.5, lng: 106.5 }));
    fireEvent.click(screen.getByRole("button", { name: "Huỷ" }));
    await waitFor(() => expect(screen.queryByTestId("lazy-map")).toBeNull());
    expect(screen.getByLabelText("Vĩ độ")).toHaveProperty("value", "21.03");
    expect(screen.getByLabelText("Kinh độ")).toHaveProperty("value", "105.85");
  });

  it("shows the unsupported notice inside the picker and keeps manual entry", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Chọn trên bản đồ" }));
    await screen.findByTestId("lazy-map");
    act(() => captured.props?.onUnsupported?.());
    expect(
      await screen.findByText(viMessages.venues.mapUnsupported),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Dùng vị trí này" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Huỷ" }));
    await waitFor(() => expect(screen.queryByTestId("lazy-map")).toBeNull());
    expect(
      screen.getByRole("button", { name: "Chọn trên bản đồ" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: viMessages.venues.enterCoordsInstead,
      }),
    );
    expect(screen.getByLabelText("Vĩ độ")).toBeTruthy();
  });
});

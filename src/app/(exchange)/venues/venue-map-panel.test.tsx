// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";

vi.mock("@/components/map/lazy-map-view", () => ({
  LazyMapView: () => <div data-testid="map" />,
}));
vi.mock("@/lib/use-is-mobile", () => ({ useIsMobile: () => false }));

import { VenueMapPanel } from "./venue-map-panel";

afterEach(cleanup);

function renderPanel(loading: boolean) {
  render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <VenueMapPanel
        points={[]}
        center={{ lat: 21, lng: 105.8 }}
        radiusKm={5}
        userPosition={null}
        selectedVenue={null}
        selectedId={null}
        locale="vi"
        showSearchHere
        loading={loading}
        onSelect={() => {}}
        onMoveEnd={() => {}}
        onSearchHere={() => {}}
        onUnsupported={() => {}}
      />
    </NextIntlClientProvider>,
  );
}

describe("VenueMapPanel top overlays", () => {
  it("shows the search button alone when not loading", () => {
    renderPanel(false);
    expect(
      screen.getByRole("button", { name: "Tìm ở khu vực này" }),
    ).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows only the loading pill (not tappable) while fetching", () => {
    renderPanel(true);
    expect(
      screen.queryByRole("button", { name: "Tìm ở khu vực này" }),
    ).toBeNull();
    expect(screen.getByRole("status").className).toContain(
      "pointer-events-none",
    );
  });
});

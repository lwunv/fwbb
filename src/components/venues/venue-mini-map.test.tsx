// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
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

import { VenueMiniMap } from "./venue-mini-map";

afterEach(() => {
  cleanup();
  captured.props = null;
});

const venue = { id: 7, name: "Sân Cầu Giấy", lat: 21.03, lng: 105.85 };

function renderMini() {
  return render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <VenueMiniMap venue={venue} />
    </NextIntlClientProvider>,
  );
}

describe("VenueMiniMap", () => {
  it("mini map renders one non-interactive point and links to directions", () => {
    renderMini();
    expect(captured.props?.interactive).toBe(false);
    expect(captured.props?.points).toEqual([
      { kind: "venue", id: 7, lat: 21.03, lng: 105.85, label: "Sân Cầu Giấy" },
    ]);
    expect(captured.props?.center).toEqual({ lat: 21.03, lng: 105.85 });
    const link = screen.getByRole("link", {
      name: "Chỉ đường tới Sân Cầu Giấy",
    });
    expect(link.getAttribute("href")).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=21.03,105.85",
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("renders nothing when the device has no WebGL", () => {
    const { container } = renderMini();
    act(() => captured.props?.onUnsupported?.());
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

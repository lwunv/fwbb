// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactNode } from "react";
import { useVenueUrlState } from "./use-venue-url-state";

function setup(search: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NuqsTestingAdapter searchParams={search}>{children}</NuqsTestingAdapter>
  );
  return renderHook(() => useVenueUrlState(), { wrapper }).result.current[0];
}

describe("useVenueUrlState", () => {
  it("defaults to r=5, no amenities, exchange and open off, no lat/lng/venue", () => {
    expect(setup("")).toEqual({
      r: 5,
      amenities: [],
      exchange: false,
      open: false,
      lat: null,
      lng: null,
      venue: null,
    });
  });

  it("ignores r=7, amenities=foo and view=list", () => {
    const s = setup("?r=7&amenities=foo&view=list");
    expect(s.r).toBe(5);
    expect(s.amenities).toEqual([]);
    expect(s).not.toHaveProperty("view");
  });

  it("reads lat/lng as numbers and lat=abc as null", () => {
    expect(setup("?lat=10&lng=114.5")).toMatchObject({ lat: 10, lng: 114.5 });
    expect(setup("?lat=abc&lng=114").lat).toBeNull();
  });
});

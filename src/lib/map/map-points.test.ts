import { describe, expect, it } from "vitest";
import { haversineMeters } from "@/lib/geo";
import {
  MAP_STYLE_URL,
  movedBeyond,
  radiusCircle,
  venuesToPoints,
  zoomForRadiusKm,
} from "./map-points";

const CENTER = { lat: 10.7769, lng: 106.7009 };

describe("zoomForRadiusKm", () => {
  it.each([
    [3, 13],
    [5, 12],
    [10, 11],
    [20, 10],
  ])("%s km -> zoom %s", (km, zoom) => {
    expect(zoomForRadiusKm(km)).toBe(zoom);
  });
});

describe("radiusCircle", () => {
  it("is a closed ring with steps + 1 points", () => {
    const ring = radiusCircle(CENTER, 5).geometry.coordinates[0];
    expect(ring).toHaveLength(65);
    expect(ring[0]).toEqual(ring[64]);
  });

  it("keeps every point within 1% of the radius from the center", () => {
    for (const km of [3, 10]) {
      const ring = radiusCircle(CENTER, km).geometry.coordinates[0];
      for (const [lng, lat] of ring) {
        const d = haversineMeters(CENTER, { lat, lng });
        expect(Math.abs(d - km * 1000) / (km * 1000)).toBeLessThan(0.01);
      }
    }
  });
});

describe("venuesToPoints", () => {
  it("maps venues to venue points keeping id, lat, lng and name", () => {
    expect(
      venuesToPoints([{ id: 7, lat: 10.5, lng: 106.5, name: "Sân A" }]),
    ).toEqual([
      { kind: "venue", id: 7, lat: 10.5, lng: 106.5, label: "Sân A" },
    ]);
  });
});

describe("movedBeyond", () => {
  const north = (km: number) => ({
    lat: CENTER.lat + km / 111.195,
    lng: CENTER.lng,
  });
  it("is false under the threshold and true over it", () => {
    expect(movedBeyond(CENTER, north(0.4), 0.5)).toBe(false);
    expect(movedBeyond(CENTER, north(0.6), 0.5)).toBe(true);
  });
});

it("exposes the OpenFreeMap style url", () => {
  expect(MAP_STYLE_URL).toBe("https://tiles.openfreemap.org/styles/liberty");
});

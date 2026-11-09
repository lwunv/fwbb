import { describe, it, expect } from "vitest";
import {
  venuesToPoints,
  venuesToPointsWithExchanges,
} from "@/lib/map/map-points";

const venues = [
  { id: 1, lat: 21.03, lng: 105.85, name: "A" },
  { id: 2, lat: 21.01, lng: 105.8, name: "B" },
  { id: 3, lat: 21.0, lng: 105.7, name: "C" },
];

describe("venuesToPointsWithExchanges", () => {
  it("sets exchangeCount only above 0", () => {
    const pts = venuesToPointsWithExchanges(
      venues,
      new Map([
        [1, 2],
        [2, 0],
      ]),
    );
    expect(pts.map((p) => p.label)).toEqual(["A", "B", "C"]);
    expect(pts[0]).toMatchObject({ kind: "venue", id: 1, exchangeCount: 2 });
    expect("exchangeCount" in pts[1]).toBe(false);
    expect("exchangeCount" in pts[2]).toBe(false);
  });

  it("undefined counts gives plain venue points", () => {
    expect(venuesToPointsWithExchanges(venues, undefined)).toEqual(
      venuesToPoints(venues),
    );
  });
});

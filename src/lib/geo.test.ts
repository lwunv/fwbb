import { describe, it, expect } from "vitest";
import {
  haversineMeters,
  boundingBox,
  formatDistance,
  isInVietnam,
  snapToGrid,
} from "./geo";

describe("haversineMeters", () => {
  it("hai điểm cùng vĩ độ 21.0287 lệch 0,0034° kinh ~ 350 m", () => {
    const d = haversineMeters(
      { lat: 21.0287, lng: 105.8523 },
      { lat: 21.0287, lng: 105.8489 },
    );
    expect(d).toBeGreaterThan(300);
    expect(d).toBeLessThan(450);
  });

  it("cùng điểm = 0", () => {
    expect(haversineMeters({ lat: 10, lng: 106 }, { lat: 10, lng: 106 })).toBe(
      0,
    );
  });
});

describe("boundingBox", () => {
  it("mọi điểm cách tâm ≤ r đều nằm trong khung", () => {
    const c = { lat: 21.03, lng: 105.85 };
    const bb = boundingBox(c, 5000);
    for (const deg of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const rad = (deg * Math.PI) / 180;
      const p = {
        lat: c.lat + (4999 / 111_320) * Math.cos(rad),
        lng:
          c.lng +
          (4999 / (111_320 * Math.cos((c.lat * Math.PI) / 180))) *
            Math.sin(rad),
      };
      expect(p.lat).toBeGreaterThanOrEqual(bb.minLat);
      expect(p.lat).toBeLessThanOrEqual(bb.maxLat);
      expect(p.lng).toBeGreaterThanOrEqual(bb.minLng);
      expect(p.lng).toBeLessThanOrEqual(bb.maxLng);
    }
  });
});

describe("formatDistance", () => {
  it("850 → '850 m'", () => expect(formatDistance(850, "vi")).toBe("850 m"));
  it("2345 vi → '2,3 km'", () =>
    expect(formatDistance(2345, "vi")).toBe("2,3 km"));
  it("2345 en → '2.3 km'", () =>
    expect(formatDistance(2345, "en")).toBe("2.3 km"));
});

describe("isInVietnam", () => {
  it("Hà Nội: true", () =>
    expect(isInVietnam({ lat: 21.03, lng: 105.85 })).toBe(true));
  it("đảo lat/lng: false", () =>
    expect(isInVietnam({ lat: 105.85, lng: 21.03 })).toBe(false));
});

describe("snapToGrid", () => {
  it("21.0349, 105.8461 → 21.03, 105.85", () =>
    expect(snapToGrid({ lat: 21.0349, lng: 105.8461 })).toEqual({
      lat: 21.03,
      lng: 105.85,
    }));
});

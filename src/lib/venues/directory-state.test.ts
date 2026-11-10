// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  DEFAULT_CENTER,
  LAST_AREA_KEY,
  LIST_RETURN_KEY,
  readListReturn,
  writeListReturn,
  exactVenueMatch,
  filterVenues,
  matchVenuesByName,
  parseUrlCenter,
  readStoredArea,
  resolveCenter,
  roundCoord,
  writeStoredArea,
} from "./directory-state";

const HN = { lat: 21.0285, lng: 105.8542 };

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("parseUrlCenter", () => {
  it("rejects null, NaN, Infinity, lat 999 and Bangkok, accepts Hà Nội and 10,114", () => {
    expect(parseUrlCenter(null, 105)).toBeNull();
    expect(parseUrlCenter(21, null)).toBeNull();
    expect(parseUrlCenter(NaN, 105)).toBeNull();
    expect(parseUrlCenter(21, Infinity)).toBeNull();
    expect(parseUrlCenter(999, 105)).toBeNull();
    expect(parseUrlCenter(13.7563, 100.5018)).toBeNull();
    expect(parseUrlCenter(21.0285, 105.8542)).toEqual(HN);
    expect(parseUrlCenter(10, 114)).toEqual({ lat: 10, lng: 114 });
  });
});

describe("roundCoord", () => {
  it("keeps 5 decimals", () => {
    expect(roundCoord(21.0285412345)).toBe(21.02854);
    expect(roundCoord(105.8)).toBe(105.8);
  });
});

describe("resolveCenter", () => {
  it("prefers url, then gps, then stored, then Hà Nội", () => {
    const url = { lat: 10.8, lng: 106.7 };
    const gps = { lat: 16.05, lng: 108.2 };
    const stored = { lat: 20.8, lng: 106.6, label: "Hải Phòng" };
    expect(resolveCenter({ url, gps, stored })).toEqual({
      center: url,
      source: "url",
      label: null,
    });
    expect(resolveCenter({ url: null, gps, stored })).toEqual({
      center: gps,
      source: "gps",
      label: null,
    });
    expect(resolveCenter({ url: null, gps: null, stored })).toEqual({
      center: { lat: 20.8, lng: 106.6 },
      source: "stored",
      label: "Hải Phòng",
    });
    expect(resolveCenter({ url: null, gps: null, stored: null })).toEqual({
      center: DEFAULT_CENTER,
      source: "default",
      label: null,
    });
    expect(DEFAULT_CENTER).toEqual(HN);
  });
});

describe("stored area", () => {
  it("readStoredArea returns null for garbage JSON, wrong shape, outside Vietnam and when localStorage throws, and accepts a Trường Sa area", () => {
    localStorage.setItem(LAST_AREA_KEY, "{not json");
    expect(readStoredArea()).toBeNull();
    localStorage.setItem(LAST_AREA_KEY, JSON.stringify({ lat: "a", lng: 1 }));
    expect(readStoredArea()).toBeNull();
    localStorage.setItem(
      LAST_AREA_KEY,
      JSON.stringify({ lat: 13.75, lng: 100.5, label: "Bangkok" }),
    );
    expect(readStoredArea()).toBeNull();
    localStorage.setItem(
      LAST_AREA_KEY,
      JSON.stringify({ lat: 10, lng: 114, label: "Trường Sa" }),
    );
    expect(readStoredArea()).toEqual({ lat: 10, lng: 114, label: "Trường Sa" });

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readStoredArea()).toBeNull();
  });

  it("writeStoredArea round-trips and never throws when storage throws", () => {
    const a = { lat: 21.0285, lng: 105.8542, label: "Hà Nội" };
    writeStoredArea(a);
    expect(readStoredArea()).toEqual(a);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => writeStoredArea(a)).not.toThrow();
  });
});

describe("filterVenues", () => {
  const now = new Date("2026-11-09T05:00:00Z"); // 12:00 VN
  const venues = [
    { id: 1, openHours: "5:00-23:00" },
    { id: 2, openHours: "14:00-22:00" },
    { id: 3, openHours: null },
    { id: 4, openHours: "Sáng 5-9" },
  ];

  it("exchangeOnly keeps count > 0 and ignores the filter when counts is undefined", () => {
    const counts = new Map([
      [1, 2],
      [2, 0],
    ]);
    const base = { openNow: false, now };
    expect(
      filterVenues(venues, { ...base, exchangeOnly: true, counts }).map(
        (v) => v.id,
      ),
    ).toEqual([1]);
    expect(
      filterVenues(venues, { ...base, exchangeOnly: true, counts: undefined }),
    ).toHaveLength(4);
    expect(
      filterVenues(venues, { ...base, exchangeOnly: false, counts }),
    ).toHaveLength(4);
  });

  it("openNow drops closed and unknown hours", () => {
    expect(
      filterVenues(venues, {
        exchangeOnly: false,
        counts: undefined,
        openNow: true,
        now,
      }).map((v) => v.id),
    ).toEqual([1]);
  });
});

describe("name matching", () => {
  const venues = [
    { name: "Sân cầu lông Cầu Giấy", distanceM: 900 },
    { name: "Cầu Giấy Arena", distanceM: 3000 },
    { name: "Cầu Giấy Sport", distanceM: 1000 },
    { name: "Nhà thi đấu Đống Đa", distanceM: 100 },
  ];

  it("matchVenuesByName ignores accents, ranks prefix matches first then by distance, caps at 5, returns [] under 2 chars", () => {
    expect(matchVenuesByName(venues, "cau giay").map((v) => v.name)).toEqual([
      "Cầu Giấy Sport",
      "Cầu Giấy Arena",
      "Sân cầu lông Cầu Giấy",
    ]);
    expect(matchVenuesByName(venues, "c")).toEqual([]);
    expect(matchVenuesByName(venues, " ")).toEqual([]);
    const many = Array.from({ length: 9 }, (_, i) => ({
      name: `Sân ${i}`,
      distanceM: i,
    }));
    expect(matchVenuesByName(many, "san")).toHaveLength(5);
    expect(matchVenuesByName(venues, "dong da")[0].name).toBe(
      "Nhà thi đấu Đống Đa",
    );
  });

  it('exactVenueMatch matches "san cau long cau giay" to "Sân cầu lông Cầu Giấy" but not "Cầu Giấy"', () => {
    expect(exactVenueMatch(venues, "san cau long cau giay")?.name).toBe(
      "Sân cầu lông Cầu Giấy",
    );
    expect(exactVenueMatch(venues, "Cầu Giấy")).toBeNull();
  });
});

// Final review F6: the detail page's back link keeps the list filters only
// when it was opened from that list for the same venue.
describe("list return marker", () => {
  afterEach(() => sessionStorage.clear());

  it("returns the remembered list URL only for the same venue", () => {
    writeListReturn(3, "/venues?r=10&open=true");
    expect(readListReturn(3)).toBe("/venues?r=10&open=true");
    expect(readListReturn(4)).toBeNull();
  });

  it("rejects anything that is not a /venues list URL", () => {
    for (const href of [
      "https://evil.example/venues",
      "//evil.example/venues",
      "/venues/3",
      "/exchanges",
      "/venuesx",
    ]) {
      sessionStorage.setItem(LIST_RETURN_KEY, JSON.stringify({ id: 3, href }));
      expect(readListReturn(3)).toBeNull();
    }
    sessionStorage.setItem(LIST_RETURN_KEY, "{not json");
    expect(readListReturn(3)).toBeNull();
  });

  it("blocked storage is not an error", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => writeListReturn(3, "/venues")).not.toThrow();
    expect(readListReturn(3)).toBeNull();
  });
});

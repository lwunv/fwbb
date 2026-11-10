import { describe, it, expect } from "vitest";
import { VN_ISLAND_AREAS, VN_ISLAND_LABELS } from "./sovereignty";
import { isInVietnamOrIslands, islandLabelAt } from "./island-label";

describe("islandLabelAt", () => {
  it("16.5,112.0 gives the Hoàng Sa label in vi", () => {
    expect(islandLabelAt({ lat: 16.5, lng: 112.0 }, "vi")).toBe(
      "Quần đảo Hoàng Sa (Việt Nam)",
    );
  });

  it('10.0,114.0 gives "Truong Sa Archipelago (Viet Nam)" in en', () => {
    expect(islandLabelAt({ lat: 10.0, lng: 114.0 }, "en")).toBe(
      "Truong Sa Archipelago (Viet Nam)",
    );
  });

  it("Hà Nội gives null", () => {
    expect(islandLabelAt({ lat: 21.0285, lng: 105.8542 }, "vi")).toBeNull();
  });

  it("areas and labels have the same length", () => {
    expect(VN_ISLAND_AREAS.coordinates.length).toBe(VN_ISLAND_LABELS.length);
  });
});

describe("isInVietnamOrIslands", () => {
  it("accepts Hà Nội and 10,114, rejects Bangkok", () => {
    expect(isInVietnamOrIslands({ lat: 21.0285, lng: 105.8542 })).toBe(true);
    expect(isInVietnamOrIslands({ lat: 10, lng: 114 })).toBe(true);
    expect(isInVietnamOrIslands({ lat: 13.7563, lng: 100.5018 })).toBe(false);
  });
});

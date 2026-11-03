import { describe, it, expect } from "vitest";
import { parseLatLngFromMapsUrl, directionsUrl } from "./maps-link";

describe("parseLatLngFromMapsUrl", () => {
  it("ưu tiên !3d!4d (toạ độ địa điểm) hơn @ (tâm khung nhìn)", () =>
    expect(
      parseLatLngFromMapsUrl(
        "https://www.google.com/maps/place/San+ABC/@21.0300,105.8400,17z/data=!3m1!4b1!4m6!3m5!8m2!3d21.0312!4d105.8423",
      ),
    ).toEqual({ lat: 21.0312, lng: 105.8423 }));

  it("dạng @lat,lng,zoom", () =>
    expect(
      parseLatLngFromMapsUrl(
        "https://www.google.com/maps/@10.7769,106.7009,15z",
      ),
    ).toEqual({ lat: 10.7769, lng: 106.7009 }));

  it("dạng ?q=lat,lng", () =>
    expect(
      parseLatLngFromMapsUrl("https://maps.google.com/?q=21.03,105.85"),
    ).toEqual({ lat: 21.03, lng: 105.85 }));

  it("dạng ?query=lat%2Clng (api=1)", () =>
    expect(
      parseLatLngFromMapsUrl(
        "https://www.google.com/maps/search/?api=1&query=21.03%2C105.85",
      ),
    ).toEqual({ lat: 21.03, lng: 105.85 }));

  it("lat ngoài [-90,90] → null", () =>
    expect(
      parseLatLngFromMapsUrl("https://maps.google.com/?q=105.85,21.03"),
    ).toBeNull());

  it("host lạ → null", () =>
    expect(
      parseLatLngFromMapsUrl("https://evil.example/?q=21.03,105.85"),
    ).toBeNull());

  it("chỉ có tên, không toạ độ → null", () =>
    expect(
      parseLatLngFromMapsUrl("https://www.google.com/maps/place/San+ABC"),
    ).toBeNull());

  it("chuỗi không phải URL → null", () =>
    expect(parseLatLngFromMapsUrl("not a url")).toBeNull());
});

describe("directionsUrl", () => {
  it("tạo link chỉ đường Google Maps", () =>
    expect(directionsUrl({ lat: 21.03, lng: 105.85 })).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=21.03,105.85",
    ));
});

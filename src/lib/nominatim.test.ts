import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { geocodeNominatim, __resetNominatimThrottle } from "./nominatim";

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const HIT = [
  { lat: "21.0285", lon: "105.8542", display_name: "Hoàn Kiếm, Hà Nội" },
];

beforeEach(() => __resetNominatimThrottle());
afterEach(() => vi.useRealTimers());

describe("geocodeNominatim", () => {
  it("gọi đúng URL có countrycodes=vn, format=jsonv2, limit=1 và User-Agent riêng", async () => {
    const f = vi.fn().mockResolvedValue(ok(HIT));
    const r = await geocodeNominatim("Hoàn Kiếm", f);
    expect(r).toEqual({
      lat: 21.0285,
      lng: 105.8542,
      label: "Hoàn Kiếm, Hà Nội",
    });
    const [url, init] = f.mock.calls[0];
    const u = new URL(url as string);
    expect(u.origin + u.pathname).toBe(
      "https://nominatim.openstreetmap.org/search",
    );
    expect(u.searchParams.get("countrycodes")).toBe("vn");
    expect(u.searchParams.get("format")).toBe("jsonv2");
    expect(u.searchParams.get("limit")).toBe("1");
    expect(u.searchParams.get("q")).toBe("Hoàn Kiếm");
    expect((init as RequestInit).headers).toMatchObject({
      "User-Agent": expect.stringMatching(/^FWBB\//),
    });
  });

  it("hai lời gọi liền nhau cách ≥ 1000 ms", async () => {
    vi.useFakeTimers();
    const times: number[] = [];
    const f = vi.fn().mockImplementation(async () => {
      times.push(Date.now());
      return ok(HIT);
    });
    const p1 = geocodeNominatim("a", f);
    const p2 = geocodeNominatim("b", f);
    await vi.advanceTimersByTimeAsync(2500);
    await Promise.all([p1, p2]);
    expect(times).toHaveLength(2);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(1000);
  });

  it("không có kết quả → null", async () => {
    const f = vi.fn().mockResolvedValue(ok([]));
    expect(await geocodeNominatim("xyz", f)).toBeNull();
  });

  it("HTTP lỗi hoặc fetch throw → null", async () => {
    expect(
      await geocodeNominatim(
        "a",
        vi.fn().mockResolvedValue(new Response("", { status: 429 })),
      ),
    ).toBeNull();
    __resetNominatimThrottle();
    expect(
      await geocodeNominatim("a", vi.fn().mockRejectedValue(new Error("down"))),
    ).toBeNull();
  });

  it("query rỗng hoặc > 200 ký tự → null, không gọi fetch", async () => {
    const f = vi.fn();
    expect(await geocodeNominatim("   ", f)).toBeNull();
    expect(await geocodeNominatim("x".repeat(201), f)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});

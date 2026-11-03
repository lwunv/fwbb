import { describe, it, expect, vi } from "vitest";
import { resolveMapsLink } from "./maps-link-resolve";

const redirect = (location: string) =>
  new Response(null, { status: 302, headers: { location } });

describe("resolveMapsLink", () => {
  it("đi theo redirect của maps.app.goo.gl rồi tách toạ độ", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        redirect(
          "https://www.google.com/maps/place/X/data=!3d21.0312!4d105.8423",
        ),
      );
    expect(await resolveMapsLink("https://maps.app.goo.gl/abc", f)).toEqual({
      lat: 21.0312,
      lng: 105.8423,
    });
    expect(f).toHaveBeenCalledWith(
      "https://maps.app.goo.gl/abc",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("redirect sang host ngoài allowlist → null, không fetch tiếp", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(redirect("http://169.254.169.254/latest"));
    expect(await resolveMapsLink("https://maps.app.goo.gl/abc", f)).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("quá 5 lần redirect → null", async () => {
    const f = vi
      .fn()
      .mockImplementation(async () => redirect("https://maps.app.goo.gl/loop"));
    expect(await resolveMapsLink("https://maps.app.goo.gl/loop", f)).toBeNull();
    expect(f).toHaveBeenCalledTimes(5);
  });

  it("link đầy đủ có toạ độ → không gọi mạng", async () => {
    const f = vi.fn();
    expect(
      await resolveMapsLink("https://maps.google.com/?q=21.03,105.85", f),
    ).toEqual({ lat: 21.03, lng: 105.85 });
    expect(f).not.toHaveBeenCalled();
  });

  it("host không phải link rút gọn và không có toạ độ → null, không gọi mạng", async () => {
    const f = vi.fn();
    expect(await resolveMapsLink("https://example.com/x", f)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("fetch throw (timeout) → null", async () => {
    const f = vi.fn().mockRejectedValue(new Error("timeout"));
    expect(await resolveMapsLink("https://maps.app.goo.gl/abc", f)).toBeNull();
  });
});

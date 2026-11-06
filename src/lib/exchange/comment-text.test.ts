import { describe, it, expect } from "vitest";
import { normalizeCommentBody, detectContact } from "./comment-text";

describe("normalizeCommentBody", () => {
  it("normalize trims, keeps single newlines, collapses blank runs, strips control chars", () => {
    expect(normalizeCommentBody("  a\r\nb\u0000\u0007 \n\n\n\n\nc  ")).toBe(
      "a\nb \n\nc",
    );
    expect(normalizeCommentBody("e\u0301")).toBe("\u00e9");
  });
});

describe("detectContact phone", () => {
  it('detects 0912345678, 0912 345 678, 091 234 5678, 0912.345.678, +84 912 345 678, 84912345678, "0 9 1 2 3 4 5 6 7 8"', () => {
    for (const s of [
      "0912345678",
      "0912 345 678",
      "091 234 5678",
      "0912.345.678",
      "+84 912 345 678",
      "84912345678",
      "0 9 1 2 3 4 5 6 7 8",
      "lien he 0912345678 nhe",
    ]) {
      expect(detectContact(s).phone, s).toBe(true);
    }
  });

  it('does not flag "Buổi 09.11.2026 19:30 còn slot không?", "05/12 lúc 19h, 2 slot", 120.000, 1.200.000đ, 2026-11-20, slot 12/24, 0912345 (7 số)', () => {
    for (const s of [
      "Buổi 09.11.2026 19:30 còn slot không?",
      "05/12 lúc 19h, 2 slot",
      "120.000",
      "1.200.000đ",
      "2026-11-20",
      "slot 12/24",
      "0912345",
    ]) {
      expect(detectContact(s).phone, s).toBe(false);
    }
  });
});

describe("detectContact link", () => {
  it("detects https://, www., shopee.vn/abc, zalo.me/g/abc, fb.com/x, t.me/x", () => {
    for (const s of [
      "https://x.y",
      "www.abc",
      "shopee.vn/abc",
      "zalo.me/g/abc",
      "fb.com/x",
      "t.me/x",
      "SHOPEE.VN",
    ]) {
      expect(detectContact(s).link, s).toBe(true);
    }
  });

  it('does not flag "cầu.Thành Công" or "a.b"', () => {
    expect(detectContact("cầu.Thành Công").link).toBe(false);
    expect(detectContact("a.b").link).toBe(false);
  });
});

describe("zero-width and bidi characters", () => {
  it("normalize strips zero-width and bidi control characters", () => {
    expect(
      normalizeCommentBody("a\u200Bb\u200Fc\u202Ad\u202Ee\u2060f\uFEFFg"),
    ).toBe("abcdefg");
  });

  it("cannot bypass phone and link detection", () => {
    expect(detectContact(normalizeCommentBody("0912\u200B345678")).phone).toBe(
      true,
    );
    expect(
      detectContact(normalizeCommentBody("shopee\u200B.vn/abc")).link,
    ).toBe(true);
  });
});

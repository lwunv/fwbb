import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: vi.fn() }));

import { hashedIpKey, ipRateLimitKey } from "./client-ip";

describe("ipRateLimitKey", () => {
  it("giữ nguyên IPv4", () => {
    expect(ipRateLimitKey("203.0.113.7")).toBe("203.0.113.7");
  });

  it("hai IPv6 cùng /64 cho cùng khoá", () => {
    const a = ipRateLimitKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd");
    const b = ipRateLimitKey("2001:db8:1:2::1");
    expect(a).toBe(b);
    expect(a).toBe("2001:db8:1:2::/64");
  });

  it("IPv6 khác /64 cho khoá khác", () => {
    expect(ipRateLimitKey("2001:db8:1:3::1")).not.toBe(
      ipRateLimitKey("2001:db8:1:2::1"),
    );
  });

  it('"::1" không lỗi', () => {
    expect(() => ipRateLimitKey("::1")).not.toThrow();
    expect(ipRateLimitKey("::1")).toBe("0:0:0:0::/64");
  });
});

describe("hashedIpKey", () => {
  it("32 ký tự hex, không chứa IP gốc, ổn định", () => {
    const ip = "203.0.113.7";
    const k = hashedIpKey(ip);
    expect(k).toMatch(/^[0-9a-f]{32}$/);
    expect(k).not.toContain("203");
    expect(hashedIpKey(ip)).toBe(k);
  });

  it("IP khác cho khoá khác, IPv6 cùng /64 cho cùng khoá", () => {
    expect(hashedIpKey("203.0.113.7")).not.toBe(hashedIpKey("203.0.113.8"));
    expect(hashedIpKey("2001:db8:1:2::5")).toBe(
      hashedIpKey("2001:db8:1:2:f::9"),
    );
  });
});

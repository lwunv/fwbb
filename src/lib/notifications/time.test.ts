import { describe, it, expect } from "vitest";
import {
  isQuietHourVN,
  nextQuietEndVN,
  sessionStartInstant,
  startOfVNDay,
  vnDate,
} from "./time";

// Mọi mốc viết bằng `Z` hoặc `+07:00` rõ ràng: kết quả không được phụ thuộc
// múi giờ của máy chạy test (chạy với TZ=UTC như server Vercel).
describe("VN time helpers", () => {
  it("quiet hours are 22:00 to before 07:00 VN", () => {
    expect(isQuietHourVN(new Date("2026-11-10T21:59:59+07:00"))).toBe(false);
    expect(isQuietHourVN(new Date("2026-11-10T22:00:00+07:00"))).toBe(true);
    expect(isQuietHourVN(new Date("2026-11-10T23:10:00+07:00"))).toBe(true);
    expect(isQuietHourVN(new Date("2026-11-11T00:30:00+07:00"))).toBe(true);
    expect(isQuietHourVN(new Date("2026-11-11T06:59:59+07:00"))).toBe(true);
    expect(isQuietHourVN(new Date("2026-11-11T07:00:00+07:00"))).toBe(false);
    expect(isQuietHourVN(new Date("2026-11-11T12:00:00+07:00"))).toBe(false);
  });

  it("nextQuietEndVN is the next 07:00 VN", () => {
    expect(
      nextQuietEndVN(new Date("2026-11-10T23:10:00+07:00")).toISOString(),
    ).toBe(new Date("2026-11-11T07:00:00+07:00").toISOString());
    expect(
      nextQuietEndVN(new Date("2026-11-11T05:30:00+07:00")).toISOString(),
    ).toBe(new Date("2026-11-11T07:00:00+07:00").toISOString());
    expect(
      nextQuietEndVN(new Date("2026-11-11T07:00:00+07:00")).toISOString(),
    ).toBe(new Date("2026-11-12T07:00:00+07:00").toISOString());
  });

  it("vnDate and startOfVNDay follow the VN calendar, not UTC", () => {
    // 23:10 VN ngày 10 = 16:10Z ngày 10; 01:00 VN ngày 11 = 18:00Z ngày 10.
    expect(vnDate(new Date("2026-11-10T23:10:00+07:00"))).toBe("2026-11-10");
    expect(vnDate(new Date("2026-11-11T01:00:00+07:00"))).toBe("2026-11-11");
    expect(
      startOfVNDay(new Date("2026-11-11T01:00:00+07:00")).toISOString(),
    ).toBe("2026-11-10T17:00:00.000Z");
  });

  it("sessionStartInstant pins +07:00", () => {
    expect(sessionStartInstant("2026-11-10", "20:00").toISOString()).toBe(
      "2026-11-10T13:00:00.000Z",
    );
  });
});

import { describe, it, expect } from "vitest";
import { minutesInVietnam, openStatus, parseOpenHours } from "./open-hours";

/** Giờ VN = UTC + 7; ngày 2026-11-09. */
const vn = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 9, h - 7, m, 0));

describe("parseOpenHours", () => {
  it('parses "5:00 - 23:00", "05:00-23:00", "5h-22h", "5h30-22h", "5.30-22.00", "5:00 đến 23:00"', () => {
    expect(parseOpenHours("5:00 - 23:00")).toEqual([{ start: 300, end: 1380 }]);
    expect(parseOpenHours("05:00-23:00")).toEqual([{ start: 300, end: 1380 }]);
    expect(parseOpenHours("5h-22h")).toEqual([{ start: 300, end: 1320 }]);
    expect(parseOpenHours("5h30-22h")).toEqual([{ start: 330, end: 1320 }]);
    expect(parseOpenHours("5.30-22.00")).toEqual([{ start: 330, end: 1320 }]);
    expect(parseOpenHours("5:00 đến 23:00")).toEqual([
      { start: 300, end: 1380 },
    ]);
  });

  it('two ranges "05:00-11:00, 14:00-22:00" are closed at 12:00 VN', () => {
    expect(parseOpenHours("05:00-11:00, 14:00-22:00")).toHaveLength(2);
    expect(openStatus("05:00-11:00, 14:00-22:00", vn(12))).toBe("closed");
    expect(openStatus("05:00-11:00, 14:00-22:00", vn(15))).toBe("open");
  });

  it('"22:00-02:00" is open at 23:30 and 01:00, closed at 03:00', () => {
    expect(openStatus("22:00-02:00", vn(23, 30))).toBe("open");
    expect(openStatus("22:00-02:00", vn(1))).toBe("open");
    expect(openStatus("22:00-02:00", vn(3))).toBe("closed");
  });

  it('end is exclusive: "5:00-23:00" closed at 23:00, open at 5:00', () => {
    expect(openStatus("5:00-23:00", vn(23))).toBe("closed");
    expect(openStatus("5:00-23:00", vn(5))).toBe("open");
  });

  it('"24/7", "24h", "0:00-24:00" are open all day', () => {
    for (const raw of ["24/7", "24h", "0:00-24:00"]) {
      expect(parseOpenHours(raw)).toEqual([{ start: 0, end: 1440 }]);
      expect(openStatus(raw, vn(3))).toBe("open");
      expect(openStatus(raw, vn(23, 59))).toBe("open");
    }
  });

  it('returns null for "", "   ", "abc", "6:00-6:00", "25:00-26:00", "5:61-6:00", "T2-T6 5:00-22:00", "Sáng 5-9"', () => {
    for (const raw of [
      "",
      "   ",
      "abc",
      "6:00-6:00",
      "25:00-26:00",
      "5:61-6:00",
      "T2-T6 5:00-22:00",
      "Sáng 5-9",
    ]) {
      expect(parseOpenHours(raw)).toBeNull();
    }
    expect(parseOpenHours(null)).toBeNull();
    expect(parseOpenHours(undefined)).toBeNull();
  });
});

describe("openStatus", () => {
  it("openStatus is unknown for null and unparseable", () => {
    expect(openStatus(null, vn(10))).toBe("unknown");
    expect(openStatus("Sáng 5-9", vn(10))).toBe("unknown");
  });
});

describe("minutesInVietnam", () => {
  it("2026-11-09T16:30:00Z is minute 1410 in Vietnam", () => {
    expect(minutesInVietnam(new Date("2026-11-09T16:30:00Z"))).toBe(1410);
  });
});

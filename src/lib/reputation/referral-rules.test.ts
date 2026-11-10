import { describe, expect, it } from "vitest";
import {
  canRefer,
  referralBrokenAt,
  referrerBlockedUntil,
  vnDisplayDate,
  vnMonthBounds,
} from "./referral-rules";

const DAY = 86_400_000;
const T0 = "2026-11-01T03:00:00.000Z";
const t0 = Date.parse(T0);
const at = (days: number) => new Date(t0 + days * DAY).toISOString();

describe("canRefer", () => {
  it("3 attended at 3/3 yes; 4 of 5 yes; 3 of 4 no; group sessions count toward 3; no exchange history passes the rate rule", () => {
    expect(canRefer({ attendedTotal: 3, attended: 3, approvedPast: 3 })).toBe(
      true,
    );
    expect(canRefer({ attendedTotal: 5, attended: 4, approvedPast: 5 })).toBe(
      true,
    );
    expect(canRefer({ attendedTotal: 3, attended: 3, approvedPast: 4 })).toBe(
      false,
    );
    // 1 buổi giao lưu + 2 buổi nhóm: đủ 3 buổi đã đến.
    expect(canRefer({ attendedTotal: 3, attended: 1, approvedPast: 1 })).toBe(
      true,
    );
    expect(canRefer({ attendedTotal: 2, attended: 2, approvedPast: 2 })).toBe(
      false,
    );
    // Chỉ chơi buổi nhóm, chưa có buổi giao lưu nào được duyệt.
    expect(canRefer({ attendedTotal: 3, attended: 0, approvedPast: 0 })).toBe(
      true,
    );
  });
});

describe("referralBrokenAt", () => {
  it("the second incident inside 30 days breaks it at that time; incidents before or after day 30 do not count", () => {
    expect(referralBrokenAt(T0, [])).toBeNull();
    expect(referralBrokenAt(T0, [at(5)])).toBeNull();
    // Thứ tự đầu vào không quan trọng.
    expect(referralBrokenAt(T0, [at(20), at(5)])).toBe(at(20));
    expect(referralBrokenAt(T0, [at(5), at(20), at(25)])).toBe(at(20));
    // Trước lúc được giới thiệu và sau ngày 30 không tính.
    expect(referralBrokenAt(T0, [at(-1), at(5)])).toBeNull();
    expect(referralBrokenAt(T0, [at(5), at(31)])).toBeNull();
    // Đúng mốc 30 ngày vẫn còn trong cửa sổ.
    expect(referralBrokenAt(T0, [at(5), at(30)])).toBe(at(30));
  });
});

describe("referrerBlockedUntil", () => {
  it("30 days after the latest break, null once passed", () => {
    const now = new Date(t0 + 10 * DAY);
    expect(referrerBlockedUntil([], now)).toBeNull();
    expect(referrerBlockedUntil([at(2), at(8)], now)).toBe(at(38));
    expect(referrerBlockedUntil([at(8), at(2)], now)).toBe(at(38));
    expect(referrerBlockedUntil([at(2)], new Date(t0 + 32 * DAY))).toBeNull();
    expect(referrerBlockedUntil([at(2)], new Date(t0 + 31 * DAY))).toBe(at(32));
  });
});

describe("vnMonthBounds", () => {
  it("2026-10-31T18:00Z is in November", () => {
    expect(vnMonthBounds(new Date("2026-10-31T18:00:00.000Z"))).toEqual({
      from: "2026-10-31T17:00:00.000Z",
      to: "2026-11-30T17:00:00.000Z",
    });
    expect(vnMonthBounds(new Date("2026-10-31T16:59:59.999Z"))).toEqual({
      from: "2026-09-30T17:00:00.000Z",
      to: "2026-10-31T17:00:00.000Z",
    });
    expect(vnMonthBounds(new Date("2026-12-15T00:00:00.000Z"))).toEqual({
      from: "2026-11-30T17:00:00.000Z",
      to: "2026-12-31T17:00:00.000Z",
    });
  });
});

describe("vnDisplayDate", () => {
  it("formats the Vietnam calendar day as dd/MM/yyyy", () => {
    expect(vnDisplayDate("2026-12-14T20:00:00.000Z")).toBe("15/12/2026");
    expect(vnDisplayDate("2026-12-14T16:59:59.000Z")).toBe("14/12/2026");
  });
});

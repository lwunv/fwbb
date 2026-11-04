/**
 * Phần thuần của ngưỡng sân. Server Vercel chạy UTC, nên ghim TZ=UTC để chắc
 * mốc chốt sân được tính theo giờ VN chứ không theo múi giờ máy.
 */
process.env.TZ = "UTC";

import { afterAll, describe, expect, it } from "vitest";
import { capacityRank, courtLockAt } from "./capacity";

afterAll(() => {
  delete process.env.TZ;
});

describe("capacityRank", () => {
  it("capacityRank: 13/16=0, 14/16=1, 16/16=2, 17/16=3, 18/16=3, 19/16=4", () => {
    expect(capacityRank(13, 16)).toBe(0);
    expect(capacityRank(14, 16)).toBe(1);
    expect(capacityRank(15, 16)).toBe(1);
    expect(capacityRank(16, 16)).toBe(2);
    expect(capacityRank(17, 16)).toBe(3);
    expect(capacityRank(18, 16)).toBe(3);
    expect(capacityRank(19, 16)).toBe(4);
  });

  it("small courts: no one voted is never almost full (0/2=0, 1/2=1, 2/2=2, 0/1=0)", () => {
    expect(capacityRank(0, 2)).toBe(0);
    expect(capacityRank(1, 2)).toBe(1);
    expect(capacityRank(2, 2)).toBe(2);
    expect(capacityRank(0, 1)).toBe(0);
    expect(capacityRank(1, 1)).toBe(2);
  });
});

describe("courtLockAt", () => {
  it("courtLockAt: 24h before start; vote deadline later than that wins", () => {
    const base = { date: "2026-11-05", startTime: "20:30" };
    expect(courtLockAt({ ...base, voteDeadline: null }, 24).toISOString()).toBe(
      "2026-11-04T13:30:00.000Z",
    );
    // Hạn vote sớm hơn mốc 24h: vẫn lấy mốc 24h.
    expect(
      courtLockAt(
        { ...base, voteDeadline: "2026-11-03T20:00:00" },
        24,
      ).toISOString(),
    ).toBe("2026-11-04T13:30:00.000Z");
    // Hạn vote muộn hơn: lấy hạn vote (giờ VN, 16:30 = 09:30Z).
    expect(
      courtLockAt(
        { ...base, voteDeadline: "2026-11-05T16:30:00" },
        24,
      ).toISOString(),
    ).toBe("2026-11-05T09:30:00.000Z");
    expect(courtLockAt({ ...base, voteDeadline: null }, 6).toISOString()).toBe(
      "2026-11-05T07:30:00.000Z",
    );
  });
});

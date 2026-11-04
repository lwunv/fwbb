import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import {
  buildUnvotedReminderText,
  buildLowAttendanceText,
  voteLink,
} from "./zalo-share";

// Giờ trong tin phải là giờ VN dù máy chạy múi giờ nào (server Vercel là UTC),
// nên ép UTC cho cả file thay vì trông chờ lệnh chạy test đặt sẵn TZ.
const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "UTC";
  return () => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  };
});
afterEach(() => vi.unstubAllEnvs());

describe("zalo share text", () => {
  it("unvoted text lists names and deadline in VN time", () => {
    expect(new Date(2026, 10, 6, 12).getTimezoneOffset()).toBe(0);
    const text = buildUnvotedReminderText({
      sessionDate: "2026-11-06",
      startTime: "20:30",
      // 12:00 UTC = 19:00 giờ VN
      voteDeadline: "2026-11-06T12:00:00.000Z",
      names: ["An", "Bình", "Chi"],
    });
    expect(text).toContain("An, Bình, Chi");
    expect(text).toContain("19:00");
    expect(text).toContain("06/11");
    expect(text).toContain("20:30");
    expect(text).not.toMatch(/[–—]/);
  });

  it("treats a deadline without offset as already VN local time", () => {
    const text = buildUnvotedReminderText({
      sessionDate: "2026-11-06",
      startTime: "20:30",
      voteDeadline: "2026-11-06T16:30:00",
      names: ["An"],
    });
    expect(text).toContain("16:30");
  });

  it("omits the deadline sentence when there is none", () => {
    const text = buildUnvotedReminderText({
      sessionDate: "2026-11-06",
      startTime: "20:30",
      voteDeadline: null,
      names: ["An"],
    });
    expect(text).not.toContain("Hạn vote");
  });

  it("low attendance text carries counts and the link", () => {
    const text = buildLowAttendanceText({
      sessionDate: "2026-11-06",
      startTime: "20:30",
      headcount: 7,
      maxPlayers: 16,
      link: "https://fwbb.test/vote/12",
    });
    expect(text).toContain("7/16");
    expect(text).toContain("https://fwbb.test/vote/12");
    expect(text).not.toMatch(/[–—]/);
  });

  it("voteLink uses NEXT_PUBLIC_APP_URL at call time and falls back to a relative path", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://fwbb.test/");
    expect(voteLink(12)).toBe("https://fwbb.test/vote/12");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(voteLink(12)).toBe("/vote/12");
  });
});

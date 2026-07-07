import { describe, it, expect } from "vitest";
import {
  computeDefaultDeadline,
  formatLocalDeadline,
  parseVoteDeadline,
} from "./vote-deadline";

describe("formatLocalDeadline", () => {
  it("formats a Date as YYYY-MM-DDTHH:MM:SS (no Z, local time)", () => {
    const d = new Date(2026, 4, 21, 16, 30, 0); // 2026-05-21 16:30:00 local
    expect(formatLocalDeadline(d)).toBe("2026-05-21T16:30:00");
  });

  it("zero-pads single-digit month/day/hour/minute/second", () => {
    const d = new Date(2026, 0, 5, 7, 4, 9); // 2026-01-05 07:04:09 local
    expect(formatLocalDeadline(d)).toBe("2026-01-05T07:04:09");
  });
});

describe("computeDefaultDeadline", () => {
  it("returns startTime minus 4 hours as ISO-local string", () => {
    // 2026-05-21 20:30 - 4h = 2026-05-21 16:30
    expect(computeDefaultDeadline("2026-05-21", "20:30")).toBe(
      "2026-05-21T16:30:00",
    );
  });

  it("rolls back across midnight when startTime < 04:00", () => {
    // 2026-05-21 02:30 - 4h = 2026-05-20 22:30
    expect(computeDefaultDeadline("2026-05-21", "02:30")).toBe(
      "2026-05-20T22:30:00",
    );
  });

  it("handles startTime in 24h format with leading zero", () => {
    expect(computeDefaultDeadline("2026-12-31", "08:00")).toBe(
      "2026-12-31T04:00:00",
    );
  });
});

describe("parseVoteDeadline", () => {
  it("pins a VN wall-clock deadline to +07:00 (TZ-independent instant)", () => {
    // 16:30 VN == 09:30 UTC, no matter what timezone the runtime is in. A bare
    // new Date("2026-05-21T16:30:00") on a UTC server would give 16:30Z (~7h
    // late) — the bug this helper fixes.
    expect(parseVoteDeadline("2026-05-21T16:30:00").toISOString()).toBe(
      "2026-05-21T09:30:00.000Z",
    );
  });
});

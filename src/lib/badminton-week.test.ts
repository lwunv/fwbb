import { describe, it, expect } from "vitest";
import { badmintonDatesForTargetWeek } from "./date-format";

/**
 * Tuần đích cho selector trang user: tuần HIỆN TẠI (T2→CN), nhưng nếu hôm nay
 * là T7/CN thì lấy tuần SAU (lịch tuần này đã chơi hết). 2026-06-15 = Thứ Hai.
 */
describe("badmintonDatesForTargetWeek", () => {
  const DAYS = [1, 3, 5]; // Mon, Wed, Fri

  it("T2 → tuần hiện tại", () => {
    expect(badmintonDatesForTargetWeek("2026-06-15", DAYS)).toEqual([
      "2026-06-15",
      "2026-06-17",
      "2026-06-19",
    ]);
  });

  it("T4 (giữa tuần) → vẫn tuần hiện tại (gồm T2 đã qua)", () => {
    expect(badmintonDatesForTargetWeek("2026-06-17", DAYS)).toEqual([
      "2026-06-15",
      "2026-06-17",
      "2026-06-19",
    ]);
  });

  it("T7 → tuần sau", () => {
    expect(badmintonDatesForTargetWeek("2026-06-20", DAYS)).toEqual([
      "2026-06-22",
      "2026-06-24",
      "2026-06-26",
    ]);
  });

  it("CN → tuần sau", () => {
    expect(badmintonDatesForTargetWeek("2026-06-21", DAYS)).toEqual([
      "2026-06-22",
      "2026-06-24",
      "2026-06-26",
    ]);
  });

  it("sort theo thứ tự trong tuần dù input lộn xộn", () => {
    expect(badmintonDatesForTargetWeek("2026-06-15", [5, 1, 3])).toEqual([
      "2026-06-15",
      "2026-06-17",
      "2026-06-19",
    ]);
  });
});

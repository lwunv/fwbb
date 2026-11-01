/**
 * Thứ đáng kiểm ở đây không phải việc thêm/bớt một số, mà là hai cái bẫy:
 * danh sách phải sắp xếp theo SỐ (ngày tạo buổi đọc theo thứ tự tăng dần), và
 * không bao giờ được trả về mảng rỗng, vì registry từ chối mảng rỗng và cú bấm
 * sẽ biến thành một lỗi validate khó hiểu.
 */
import { describe, it, expect } from "vitest";
import { DAY_PILLS, toggleSessionDay } from "./session-days";

describe("DAY_PILLS", () => {
  it("bắt đầu từ T2 và kết thúc ở CN, dow theo chuẩn JS", () => {
    expect(DAY_PILLS.map((d) => d.label)).toEqual([
      "T2",
      "T3",
      "T4",
      "T5",
      "T6",
      "T7",
      "CN",
    ]);
    expect(DAY_PILLS.map((d) => d.dow)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });
});

describe("toggleSessionDay", () => {
  it("thêm ngày chưa có", () => {
    expect(toggleSessionDay([1, 3], 5)).toEqual([1, 3, 5]);
  });

  it("bỏ ngày đang có", () => {
    expect(toggleSessionDay([1, 3, 5], 3)).toEqual([1, 5]);
  });

  it("sắp xếp theo số, CN (0) đứng đầu danh sách", () => {
    expect(toggleSessionDay([3, 1], 0)).toEqual([0, 1, 3]);
  });

  it("không trả mảng rỗng khi bỏ ngày cuối cùng", () => {
    expect(toggleSessionDay([3], 3)).toBeNull();
  });

  it("không sửa mảng gốc", () => {
    const current = [1, 3];
    toggleSessionDay(current, 5);
    expect(current).toEqual([1, 3]);
  });
});

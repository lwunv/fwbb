/**
 * Chốt chặn của việc nhân bản: KHÔNG ghi đè khi app đang chạy trên bản dự
 * phòng.
 *
 * Sai ở đây không phải lỗi hiển thị. Nó xoá sạch mọi thứ cả nhóm vừa nhập
 * trong lúc sự cố, và không có cách nào lấy lại.
 */
import { describe, it, expect } from "vitest";
import { mayOverwriteStandby } from "./replicate-to-standby.mjs";

describe("có được ghi đè lên bản dự phòng không", () => {
  it("đang chạy trên bản dự phòng: KHÔNG", () => {
    expect(mayOverwriteStandby({ active: "standby", since: "x" })).toBe(false);
  });

  it("cờ nói đang ở bản chính: được", () => {
    expect(mayOverwriteStandby({ active: "primary", since: "x" })).toBe(true);
  });

  it("chưa có cờ (chưa từng chuyển lần nào): được", () => {
    expect(mayOverwriteStandby(null)).toBe(true);
    expect(mayOverwriteStandby(undefined)).toBe(true);
  });

  it("cờ hỏng hình dạng: được, vì nó không nói là đang chuyển", () => {
    expect(mayOverwriteStandby({})).toBe(true);
    expect(mayOverwriteStandby({ active: "" })).toBe(true);
  });
});

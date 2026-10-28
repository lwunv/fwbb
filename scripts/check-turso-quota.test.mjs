/**
 * Phần quyết định của cảnh báo hạn mức. Test phần THUẦN, không gọi mạng.
 *
 * Bài đáng giá nhất: API trả về hình dạng lạ thì `pickRowsRead` phải trả null
 * để chỗ gọi báo đỏ. Nếu nó đoán bừa ra một số, cảnh báo sẽ báo "an toàn"
 * trong khi tài khoản sắp bị khoá, tức tệ hơn là không có cảnh báo.
 */
import { describe, it, expect } from "vitest";
import { pickRowsRead, evaluate } from "./check-turso-quota.mjs";

describe("đọc số dòng từ phản hồi API", () => {
  it("nhận các tên trường đã biết", () => {
    expect(pickRowsRead({ rows_read: 123 })).toBe(123);
    expect(pickRowsRead({ rowsRead: 456 })).toBe(456);
    expect(pickRowsRead({ rows: 789 })).toBe(789);
    expect(pickRowsRead({ total: { rows_read: 321 } })).toBe(321);
  });

  it("hình dạng LẠ thì trả null, không đoán bừa", () => {
    for (const bad of [null, undefined, {}, { foo: 1 }, { rows_read: "nhiều" }, 42, "x"]) {
      expect(pickRowsRead(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("số 0 là hợp lệ, không được nhầm thành thiếu dữ liệu", () => {
    expect(pickRowsRead({ rows_read: 0 })).toBe(0);
  });
});

describe("ngưỡng cảnh báo", () => {
  it("dưới ngưỡng thì im", () => {
    expect(evaluate(100, 1000, 70).alert).toBe(false);
  });

  it("đúng bằng ngưỡng thì đã kêu, không đợi vượt", () => {
    expect(evaluate(700, 1000, 70).alert).toBe(true);
  });

  it("vượt ngưỡng thì kêu", () => {
    const r = evaluate(900, 1000, 70);
    expect(r.alert).toBe(true);
    expect(r.percent).toBe(90);
  });

  it("con số thật của sự cố 24/10 phải kêu từ lâu", () => {
    // 653.834.434 dòng trên hạn mức 500 triệu = 130%.
    const r = evaluate(653_834_434, 500_000_000, 70);
    expect(r.alert).toBe(true);
    expect(Math.round(r.percent)).toBe(131);
  });
});

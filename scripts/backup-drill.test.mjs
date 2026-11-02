/**
 * Phần quyết định của bài diễn tập sao lưu.
 *
 * Nỗi lo ở đây giống hệt lớp canh bản dự phòng: BÁO XANH NHẦM. Một bài diễn
 * tập so sánh lỏng tay sẽ chấm "khôi phục đúng" cho một bản khôi phục mất dữ
 * liệu, và nó còn tệ hơn không diễn tập, vì sau đó không ai kiểm lại nữa.
 */
import { describe, it, expect } from "vitest";
import { normalizeRows, diffTables, fakeValue } from "./backup-drill.mjs";

describe("normalizeRows", () => {
  it("không quan tâm thứ tự dòng", () => {
    const a = normalizeRows([{ id: 1 }, { id: 2 }]);
    const b = normalizeRows([{ id: 2 }, { id: 1 }]);
    expect(a).toEqual(b);
  });

  it("không quan tâm thứ tự cột", () => {
    const a = normalizeRows([{ id: 1, name: "x" }]);
    const b = normalizeRows([{ name: "x", id: 1 }]);
    expect(a).toEqual(b);
  });

  it("phân biệt NULL với chuỗi rỗng và với số 0", () => {
    const nul = normalizeRows([{ v: null }]);
    expect(nul).not.toEqual(normalizeRows([{ v: "" }]));
    expect(nul).not.toEqual(normalizeRows([{ v: 0 }]));
  });

  it("phân biệt số 1 với chuỗi '1'", () => {
    expect(normalizeRows([{ v: 1 }])).not.toEqual(normalizeRows([{ v: "1" }]));
  });

  it("giữ được số nguyên lớn kiểu bigint", () => {
    const big = normalizeRows([{ v: 9007199254740993n }]);
    expect(big).not.toEqual(normalizeRows([{ v: 9007199254740992n }]));
    expect(big[0]).toContain("9007199254740993");
  });

  it("so sánh blob theo nội dung", () => {
    const a = normalizeRows([{ v: new Uint8Array([1, 2, 3]) }]);
    expect(a).toEqual(normalizeRows([{ v: new Uint8Array([1, 2, 3]) }]));
    expect(a).not.toEqual(normalizeRows([{ v: new Uint8Array([1, 2, 4]) }]));
  });
});

describe("diffTables", () => {
  it("giống hệt nhau thì không có khác biệt nào", () => {
    const rows = [
      { id: 1, name: "a" },
      { id: 2, name: null },
    ];
    expect(diffTables("members", rows, [...rows].reverse())).toEqual([]);
  });

  it("thiếu dòng thì báo ngay, kèm số lượng hai bên", () => {
    const out = diffTables("members", [{ id: 1 }, { id: 2 }], [{ id: 1 }]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/2 dòng trước, 1 dòng sau/);
  });

  it("một ô bị đổi giá trị cũng phải lộ ra", () => {
    const out = diffTables(
      "members",
      [{ id: 1, name: "Đặng" }],
      [{ id: 1, name: "Dang" }],
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/dòng khác nhau/);
  });

  it("chuỗi bị cắt ngắn không được coi là khớp", () => {
    const out = diffTables(
      "members",
      [{ id: 1, bank: "0123456789" }],
      [{ id: 1, bank: "01234" }],
    );
    expect(out).toHaveLength(1);
  });

  it("in tối đa 3 dòng lệch để log còn đọc được", () => {
    const before = Array.from({ length: 10 }, (_, i) => ({ id: i, v: "a" }));
    const after = Array.from({ length: 10 }, (_, i) => ({ id: i, v: "b" }));
    expect(diffTables("t", before, after)).toHaveLength(3);
  });
});

describe("fakeValue", () => {
  const col = (name, type, extra = {}) => ({
    name,
    type,
    notNull: true,
    pk: false,
    ...extra,
  });

  it("khoá chính lấy luôn số thứ tự dòng", () => {
    expect(fakeValue(col("id", "integer", { pk: true }), 3)).toBe(3);
  });

  it("cột khoá ngoại trỏ vào dòng cùng số thứ tự của bảng cha", () => {
    // Nhận biết qua PRAGMA foreign_key_list, không qua tên: `member_id_low`
    // trỏ vào members mà không kết thúc bằng `_id`.
    expect(fakeValue(col("member_id_low", "integer"), 2, true)).toBe(2);
  });

  it("cột số thường KHÔNG trùng khoá chính, để lỗi lệch cột lộ ra", () => {
    expect(fakeValue(col("amount", "integer"), 2)).not.toBe(2);
  });

  it("cột cờ chỉ nhận 0 hoặc 1", () => {
    for (const name of ["is_active", "has_paid", "member_confirmed"]) {
      expect([0, 1]).toContain(fakeValue(col(name, "integer"), 5));
    }
  });

  it("chuỗi có dấu nháy đơn và tiếng Việt có dấu", () => {
    const v = fakeValue(col("name", "text"), 1);
    expect(v).toContain("'");
    expect(v).toContain("Đặng");
  });

  it("blob ra Buffer, không ra chuỗi", () => {
    expect(Buffer.isBuffer(fakeValue(col("data", "blob"), 1))).toBe(true);
  });
});

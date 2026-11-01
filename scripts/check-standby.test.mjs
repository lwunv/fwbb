/**
 * Phần quyết định của việc canh bản dự phòng.
 *
 * Thứ đáng sợ nhất ở đây là BÁO XANH NHẦM: một bản dự phòng rỗng, cũ mèm hay
 * nối qua đường không mã hoá mà vẫn được chấm "sẵn sàng" thì tệ hơn hẳn việc
 * không có cảnh báo nào, vì nó tạo cảm giác an toàn giả cho tới đúng lúc cần.
 */
import { describe, it, expect } from "vitest";
import { evaluate } from "./check-standby.mjs";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const ok = {
  configError: null,
  reachable: true,
  missingTables: [],
  memberRows: 208,
  syncedAt: "2026-11-01T10:00:00Z",
  active: "primary",
  now: NOW,
  maxAgeHours: 12,
};

const problemsOf = (over) => evaluate({ ...ok, ...over }).problems;

describe("bản dự phòng khoẻ", () => {
  it("đủ bảng, có dữ liệu, mới nhân bản: không vấn đề gì", () => {
    const { problems, notes } = evaluate(ok);
    expect(problems).toEqual([]);
    expect(notes.join(" ")).toMatch(/2\.0 giờ/);
  });

  it("chưa từng chuyển lần nào (không có cờ): vẫn tính là ổn", () => {
    expect(problemsOf({ active: null })).toEqual([]);
  });
});

describe("những ca PHẢI báo đỏ", () => {
  it("nối qua đường không mã hoá", () => {
    const p = problemsOf({ configError: "dùng http: (không mã hoá)" });
    expect(p.join(" ")).toMatch(/không an toàn/);
  });

  it("không nối tới được, và khi đó không báo thêm thứ gì gây nhiễu", () => {
    const p = problemsOf({ reachable: false, memberRows: 0, syncedAt: null });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/Không nối tới được/);
  });

  it("thiếu bảng (chưa chạy migration)", () => {
    const p = problemsOf({ missingTables: ["members", "votes"] });
    expect(p.join(" ")).toMatch(/Thiếu 2 bảng/);
  });

  /** Nối được, đủ bảng, nhưng rỗng: đúng kiểu xanh giả nguy hiểm nhất. */
  it("database rỗng", () => {
    expect(problemsOf({ memberRows: 0 }).join(" ")).toMatch(/rỗng/);
  });

  it("chưa từng nhân bản", () => {
    expect(problemsOf({ syncedAt: null }).join(" ")).toMatch(/Chưa từng/);
  });

  it("bản sao quá cũ", () => {
    const p = problemsOf({ syncedAt: "2026-10-30T12:00:00Z" });
    expect(p.join(" ")).toMatch(/cũ 48\.0 giờ/);
  });

  it("đúng ngưỡng thì CHƯA báo, quá ngưỡng mới báo", () => {
    expect(problemsOf({ syncedAt: "2026-11-01T00:00:00Z" })).toEqual([]);
    expect(problemsOf({ syncedAt: "2026-10-31T23:59:00Z" }).join(" ")).toMatch(
      /cũ 12\.0 giờ/,
    );
  });

  it("mốc thời gian hỏng: báo đỏ chứ không lặng lẽ coi là mới", () => {
    expect(problemsOf({ syncedAt: "hôm qua" }).join(" ")).toMatch(
      /không đọc được/,
    );
  });

  it("app đang chạy trên bản dự phòng: phải hiện lên ngay", () => {
    expect(problemsOf({ active: "standby" }).join(" ")).toMatch(/ĐANG CHẠY/);
  });

  it("nhiều thứ hỏng cùng lúc thì liệt kê hết, không dừng ở cái đầu", () => {
    const p = problemsOf({
      missingTables: ["votes"],
      memberRows: 0,
      syncedAt: null,
      active: "standby",
    });
    expect(p.length).toBe(4);
  });
});

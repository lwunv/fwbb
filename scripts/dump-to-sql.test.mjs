/**
 * Sinh SQL để nạp vào Cloudflare D1.
 *
 * Bài kiểm thật sự nằm ở cuối file: dựng một SQLite trong bộ nhớ, nạp đúng
 * chuỗi SQL do script sinh ra, rồi đọc lại. So chuỗi với chuỗi chỉ chứng minh
 * tôi gõ đúng cái tôi nghĩ; chạy thật mới chứng minh nó nạp được.
 */
import { describe, it, expect } from "vitest";
import { createClient } from "@libsql/client";
import { sqlValue, dumpToSql } from "./dump-to-sql.mjs";

describe("đổi một giá trị thành literal SQL", () => {
  it("rỗng thành NULL, không thành chuỗi 'null'", () => {
    expect(sqlValue(null)).toBe("NULL");
    expect(sqlValue(undefined)).toBe("NULL");
  });

  it("số giữ nguyên, không bọc nháy", () => {
    expect(sqlValue(0)).toBe("0");
    expect(sqlValue(-120000)).toBe("-120000");
  });

  /** Tên người Việt có dấu nháy là chuyện bình thường, không phải ca hiếm. */
  it("dấu nháy trong chuỗi được nhân đôi", () => {
    expect(sqlValue("Nguyễn Thị L'An")).toBe("'Nguyễn Thị L''An'");
    expect(sqlValue("''")).toBe("''''''");
  });

  it("giữ nguyên dấu tiếng Việt", () => {
    expect(sqlValue("Lưu Nguyễn")).toBe("'Lưu Nguyễn'");
  });

  it("số không hợp lệ thì ném lỗi chứ không sinh SQL hỏng", () => {
    expect(() => sqlValue(NaN)).toThrow();
    expect(() => sqlValue(Infinity)).toThrow();
  });
});

describe("cả bản dump thành SQL", () => {
  it("dump rỗng thì ném lỗi, không sinh file rỗng", () => {
    expect(() => dumpToSql({ tables: {} })).toThrow();
  });

  it("KHÔNG tự thêm BEGIN/COMMIT (wrangler tự bọc, thêm vào là lỗi)", () => {
    const sql = dumpToSql({ tables: { a: [{ id: 1 }] } });
    expect(sql).not.toMatch(/BEGIN/i);
    expect(sql).not.toMatch(/COMMIT/i);
  });

  it("xoá theo thứ tự ngược với chèn, để không vướng khoá ngoại", () => {
    const sql = dumpToSql({ tables: { cha: [{ id: 1 }], con: [{ id: 1 }] } });
    const delCon = sql.indexOf('DELETE FROM "con"');
    const delCha = sql.indexOf('DELETE FROM "cha"');
    expect(delCon).toBeLessThan(delCha);
  });

  it("gộp nhiều dòng vào một câu INSERT", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: i }));
    const sql = dumpToSql({ tables: { t: rows } }, { rowsPerInsert: 2 });
    expect(sql.match(/INSERT INTO/g)?.length).toBe(3);
  });
});

describe("nạp thật vào SQLite rồi đọc lại", () => {
  it("dữ liệu đi qua vòng JSON → SQL → DB vẫn y nguyên", async () => {
    const dump = {
      tables: {
        members: [
          { id: 1, name: "Nguyễn Thị L'An", nickname: null, balance: -120000 },
          { id: 2, name: "Lưu Nguyễn", nickname: "Lwcifer", balance: 0 },
        ],
      },
    };
    const db = createClient({ url: ":memory:" });
    await db.execute(
      "CREATE TABLE members (id INTEGER PRIMARY KEY, name TEXT, nickname TEXT, balance INTEGER)",
    );
    await db.executeMultiple(dumpToSql(dump));

    const r = await db.execute("SELECT * FROM members ORDER BY id");
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].name).toBe("Nguyễn Thị L'An");
    expect(r.rows[0].nickname).toBeNull();
    expect(r.rows[0].balance).toBe(-120000);
    expect(r.rows[1].nickname).toBe("Lwcifer");
  });

  it("nạp lần hai không nhân đôi dữ liệu (DELETE chạy trước)", async () => {
    const dump = { tables: { t: [{ id: 1, v: "x" }] } };
    const db = createClient({ url: ":memory:" });
    await db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    await db.executeMultiple(dumpToSql(dump));
    await db.executeMultiple(dumpToSql(dump));
    const r = await db.execute("SELECT COUNT(*) AS n FROM t");
    expect(r.rows[0].n).toBe(1);
  });
});

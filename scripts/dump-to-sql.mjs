/**
 * Đổi một bản dump JSON của `backup-db.mjs` thành file .sql nạp được vào
 * Cloudflare D1.
 *
 * Vì sao phải có bước này: D1 không nói giao thức libsql, nên `restore-db.mjs`
 * không bắn thẳng vào đó được. Đường nạp dữ liệu mà Cloudflare có tài liệu là
 * `wrangler d1 execute --file=<x.sql>`.
 *
 * Phần dễ sai nhất của cả việc này nằm ở hàm `sqlValue`: một dấu nháy không
 * thoát trong tên người là câu lệnh hỏng, mà tên người Việt thì đầy dấu nháy
 * kiểu "Nguyễn Thị L'An". Nên nó tách riêng và có test.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Một giá trị JS thành đúng literal SQL. */
export function sqlValue(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`Số không hợp lệ: ${v}`);
    return String(v);
  }
  if (typeof v === "bigint") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  if (v instanceof Uint8Array || Array.isArray(v)) {
    const bytes = Array.from(v);
    return `X'${bytes.map((b) => b.toString(16).padStart(2, "0")).join("")}'`;
  }
  // Nhân đôi dấu nháy đơn là cách thoát của SQL. Ký tự NUL thì SQLite không
  // nhận trong chuỗi literal, bỏ đi còn hơn sinh ra file nạp không được.
  return `'${String(v)
    .replace(/\u0000/g, "")
    .replace(/'/g, "''")}'`;
}

/**
 * Cả bản dump thành một chuỗi SQL.
 *
 * KHÔNG có BEGIN/COMMIT: tài liệu của Cloudflare nói rõ `d1 execute` tự bọc
 * giao dịch quanh cả file, tự thêm vào là lỗi "cannot start a transaction
 * within a transaction".
 */
export function dumpToSql(dump, { rowsPerInsert = 50 } = {}) {
  const tables = Object.keys(dump?.tables ?? {});
  if (tables.length === 0) throw new Error("Dump rỗng, không có bảng nào.");

  const out = [];
  // Xoá theo thứ tự NGƯỢC rồi chèn theo thứ tự xuôi để không vướng khoá ngoại.
  for (const t of [...tables].reverse()) out.push(`DELETE FROM "${t}";`);

  for (const t of tables) {
    const rows = dump.tables[t];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const cols = Object.keys(rows[0]);
    const colList = cols.map((c) => `"${c}"`).join(", ");
    for (let i = 0; i < rows.length; i += rowsPerInsert) {
      const chunk = rows.slice(i, i + rowsPerInsert);
      const values = chunk
        .map((r) => `(${cols.map((c) => sqlValue(r[c])).join(", ")})`)
        .join(",\n  ");
      out.push(`INSERT INTO "${t}" (${colList}) VALUES\n  ${values};`);
    }
  }
  return out.join("\n") + "\n";
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [inPath, outPath] = process.argv.slice(2);
  if (!inPath || !outPath) {
    console.error("Dùng: node scripts/dump-to-sql.mjs <dump.json> <ra.sql>");
    process.exit(1);
  }
  const sql = dumpToSql(JSON.parse(readFileSync(inPath, "utf8")));
  writeFileSync(outPath, sql);
  console.log(`Đã ghi ${outPath} (${sql.length} ký tự).`);
}

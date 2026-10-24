/**
 * So sánh nội dung hai database libsql, bảng theo bảng.
 *
 * Dùng để CHỨNG MINH một lần khôi phục là đúng, thay vì tin vào số dòng. Mỗi
 * bảng được sắp xếp ổn định rồi băm, nên thứ tự trả về của database không ảnh
 * hưởng kết quả.
 *
 * Chạy:
 *   A_URL=file:a.db B_URL=file:b.db node scripts/compare-db.mjs
 *
 * Thoát 0 nếu mọi bảng khớp, 1 nếu có bảng lệch. CHỈ ĐỌC, không ghi gì.
 */

import { createClient } from "@libsql/client";
import { createHash } from "node:crypto";

const a = createClient({ url: process.env.A_URL });
const b = createClient({ url: process.env.B_URL });

const tables = (
  await a.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name",
  )
).rows.map((r) => String(r.name));

/** Chữ ký nội dung một bảng: sắp xếp ổn định rồi băm, để thứ tự trả về
 *  không ảnh hưởng kết quả so sánh. */
async function sig(c, t) {
  const res = await c.execute(`SELECT * FROM "${t}"`);
  const lines = res.rows
    .map((row) =>
      res.columns
        .map((col) => {
          const v = row[col];
          return typeof v === "bigint" ? String(Number(v)) : String(v);
        })
        .join("\u0001"),
    )
    .sort();
  return {
    n: lines.length,
    hash: createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 16),
  };
}

let bad = 0;
for (const t of tables) {
  const [x, y] = await Promise.all([sig(a, t), sig(b, t)]);
  const ok = x.n === y.n && x.hash === y.hash;
  if (!ok) bad += 1;
  console.log(
    `${ok ? "✓" : "✗"} ${t.padEnd(34)} goc ${String(x.n).padStart(5)}/${x.hash}  khoi-phuc ${String(y.n).padStart(5)}/${y.hash}`,
  );
}
console.log(bad === 0 ? `\nTAT CA ${tables.length} BANG KHOP TUNG BIT` : `\n${bad} BANG LECH`);
a.close(); b.close();
process.exit(bad === 0 ? 0 : 1);

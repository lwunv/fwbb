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

const DS_BANG =
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name";

const tables = (await a.execute(DS_BANG)).rows.map((r) => String(r.name));
const bangB = new Set((await b.execute(DS_BANG)).rows.map((r) => String(r.name)));

const cotCua = async (c, t) => (await c.execute(`SELECT * FROM "${t}" LIMIT 0`)).columns.map(String);

/**
 * Chữ ký nội dung một bảng, tính trên ĐÚNG danh sách cột được truyền vào.
 *
 * Trước đây hàm này lấy `SELECT *` của mỗi bên rồi ghép giá trị theo thứ tự
 * cột mà bên đó trả về. Như vậy chỉ cần một bên có thêm cột, hoặc hai bên xếp
 * cột khác thứ tự, là hash lệch dù dữ liệu còn nguyên. Chuyện đó xảy ra thật
 * (03/11/2026): database khôi phục dựng từ migration mới nhất nên có thêm
 * `courts.venue_id`, còn bản gốc thì chưa.
 *
 * Tên cột cũng được đưa vào nội dung băm, để đổi tên cột không lọt qua.
 */
async function sig(c, t, cols) {
  const res = await c.execute(`SELECT ${cols.map((x) => `"${x}"`).join(", ")} FROM "${t}"`);
  const lines = res.rows
    .map((row) =>
      cols
        .map((col) => {
          const v = row[col];
          return `${col}=${typeof v === "bigint" ? String(Number(v)) : String(v)}`;
        })
        .join("\u0001"),
    )
    .sort();
  return { n: lines.length, hash: createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 16) };
}

let bad = 0;
const ghiChu = [];

for (const t of tables) {
  if (!bangB.has(t)) {
    bad += 1;
    console.log(`✗ ${t.padEnd(34)} ben khoi-phuc KHONG CO bang nay`);
    continue;
  }

  const [cotA, cotB] = await Promise.all([cotCua(a, t), cotCua(b, t)]);
  const thieu = cotA.filter((c) => !cotB.includes(c));
  const them = cotB.filter((c) => !cotA.includes(c));

  // Thiếu cột của bản gốc là MẤT DỮ LIỆU, luôn tính là hỏng.
  if (thieu.length) {
    bad += 1;
    console.log(`✗ ${t.padEnd(34)} ben khoi-phuc THIEU cot: ${thieu.join(", ")}`);
    continue;
  }

  const [x, y] = await Promise.all([sig(a, t, cotA), sig(b, t, cotA)]);
  const ok = x.n === y.n && x.hash === y.hash;
  if (!ok) bad += 1;
  console.log(
    `${ok ? "✓" : "✗"} ${t.padEnd(34)} goc ${String(x.n).padStart(5)}/${x.hash}  khoi-phuc ${String(y.n).padStart(5)}/${y.hash}`,
  );

  // Đích có thêm cột là schema mới hơn, không phải mất dữ liệu. Vẫn nói ra.
  if (them.length) ghiChu.push(`${t}: ben khoi-phuc co them cot ${them.join(", ")} (schema moi hon)`);
}

if (ghiChu.length) {
  console.log("\nGhi chu (khong tinh la hong):");
  for (const g of ghiChu) console.log(`  · ${g}`);
}

console.log(bad === 0 ? `\nTAT CA ${tables.length} BANG KHOP TUNG BIT` : `\n${bad} BANG LECH`);
a.close();
b.close();
process.exit(bad === 0 ? 0 : 1);

/**
 * Full DB backup → JSON. Read-only trên DB, chỉ ghi 1 file local.
 *
 * Dump TẤT CẢ bảng (introspect qua sqlite_master) thành 1 file JSON có thể
 * dùng để khôi phục thủ công nếu reset sai. Mỗi bảng = mảng row object.
 *
 * Chạy: node scripts/backup-db.mjs            → ghi vào d:/tmp/fwbb-backup-<ts>.json
 *       node scripts/backup-db.mjs <path>     → ghi vào path chỉ định
 *
 * KHÔNG đụng gì tới DB (chỉ SELECT). An toàn chạy bất cứ lúc nào.
 */

import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@libsql/client";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url) {
  console.error("TURSO_DATABASE_URL missing trong .env.local");
  process.exit(1);
}
const client = createClient({ url, authToken });

const ts = new Date()
  .toISOString()
  .replace(/[:.]/g, "-")
  .replace("T", "_")
  .slice(0, 19);
const outPath = process.argv[2] ?? `d:/tmp/fwbb-backup-${ts}.json`;

console.log(`\n📦 BACKUP DB`);
console.log(`Database: ${url}`);
console.log(`Output:   ${outPath}\n`);

// Liệt kê mọi user table (bỏ sqlite_* internal).
const tablesRes = await client.execute(
  `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream%' AND name NOT LIKE '__drizzle%' ORDER BY name`,
);
const tables = tablesRes.rows.map((r) => String(r.name));

const dump = {
  meta: {
    database: url,
    takenAt: new Date().toISOString(),
    tableCount: tables.length,
  },
  tables: {},
};

let grandTotal = 0;
for (const t of tables) {
  const res = await client.execute(`SELECT * FROM "${t}"`);
  const rows = res.rows.map((row) => {
    // libsql Row → plain object. BigInt → Number (an toàn cho id/amount VND).
    const obj = {};
    for (const col of res.columns) {
      const v = row[col];
      obj[col] = typeof v === "bigint" ? Number(v) : v;
    }
    return obj;
  });
  dump.tables[t] = rows;
  grandTotal += rows.length;
  console.log(`  ${t.padEnd(34)} ${String(rows.length).padStart(6)} rows`);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(dump, null, 2), "utf8");

console.log(`\n✅ Đã backup ${grandTotal} rows / ${tables.length} bảng → ${outPath}`);
client.close();

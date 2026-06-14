/**
 * Clone prod (remote Turso) → local SQLite file cho e2e. KHÔNG ghi gì lên prod
 * (chỉ SELECT). Tạo `e2e/local.db` với schema = migrations 0000..mới nhất, rồi
 * copy toàn bộ row từ prod.
 *
 * ⚠️ local.db chứa dữ liệu thật (tên member = PII) → ĐÃ gitignore, KHÔNG commit.
 *
 * Chạy: node scripts/clone-db-local.mjs
 *       node scripts/clone-db-local.mjs <dest>   (mặc định e2e/local.db)
 */

import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@libsql/client";
import { readFileSync, readdirSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url) {
  console.error("TURSO_DATABASE_URL missing trong .env.local");
  process.exit(1);
}

const dest = process.argv[2] ?? "e2e/local.db";
const MIGRATIONS_DIR = join(process.cwd(), "src/db/migrations");

mkdirSync(dirname(dest), { recursive: true });
// Xoá file cũ để clone sạch.
for (const f of [dest, `${dest}-wal`, `${dest}-shm`]) {
  if (existsSync(f)) rmSync(f, { force: true });
}

const prod = createClient({ url, authToken });
const local = createClient({ url: `file:${dest.replace(/\\/g, "/")}` });

console.log(`\n📥 CLONE prod → ${dest}`);
console.log(`Source: ${url}\n`);

// ─── 1. Schema: áp tất cả migration theo thứ tự ───
const sqlFiles = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();
console.log(`Applying ${sqlFiles.length} migrations…`);
for (const file of sqlFiles) {
  const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
  const statements = sql
    .split(/--> statement-breakpoint/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    try {
      await local.execute(stmt);
    } catch (err) {
      const msg = (err && err.message) || String(err);
      if (!/already exists|duplicate column|no such/.test(msg)) throw err;
    }
  }
}

// ─── 2. Data: copy từng bảng từ prod ───
await local.execute("PRAGMA foreign_keys = OFF");

const tablesRes = await local.execute(
  `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name`,
);
const tables = tablesRes.rows.map((r) => String(r.name));

let grand = 0;
for (const t of tables) {
  let rows;
  try {
    rows = (await prod.execute(`SELECT * FROM "${t}"`)).rows;
  } catch {
    console.log(`  ↷ ${t} không có trên prod — bỏ qua`);
    continue;
  }
  if (rows.length === 0) {
    console.log(`  ${t.padEnd(34)} 0`);
    continue;
  }
  const cols = Object.keys(rows[0]);
  const placeholders = cols.map(() => "?").join(", ");
  const colList = cols.map((c) => `"${c}"`).join(", ");
  const stmts = rows.map((row) => ({
    sql: `INSERT INTO "${t}" (${colList}) VALUES (${placeholders})`,
    args: cols.map((c) => (typeof row[c] === "bigint" ? Number(row[c]) : row[c])),
  }));
  // batch theo lô 500 để tránh quá lớn.
  for (let i = 0; i < stmts.length; i += 500) {
    await local.batch(stmts.slice(i, i + 500), "write");
  }
  grand += rows.length;
  console.log(`  ${t.padEnd(34)} ${rows.length}`);
}

await local.execute("PRAGMA foreign_keys = ON");
console.log(`\n✅ Clone xong: ${grand} rows / ${tables.length} bảng → ${dest}`);
prod.close();
local.close();

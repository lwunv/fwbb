/**
 * Đẩy một bản chụp database sang Cloudflare D1.
 *
 * D1 là lớp dự phòng THỨ BA, chỉ đọc. Vai trò của nó: nếu một ngày mất cả
 * Turso lẫn máy chủ dự phòng, dữ liệu vẫn nằm ở một công ty thứ ba và truy vấn
 * được ngay, không phải đi giải mã bản sao lưu rồi dựng lại.
 *
 * D1 KHÔNG thay được Turso để ghi: nó không có giao dịch kiểu đọc-rồi-ghi, mà
 * 35 chỗ tính tiền trong app đang dựa vào đúng thứ đó. Đừng trỏ app vào đây.
 *
 * Chạy:
 *   node scripts/sync-to-d1.mjs --dump=backup.json            → chạy thử
 *   node scripts/sync-to-d1.mjs --dump=backup.json --apply    → đẩy thật
 *
 * Biến môi trường:
 *   CLOUDFLARE_API_TOKEN    token có quyền D1 Edit
 *   CLOUDFLARE_ACCOUNT_ID   id tài khoản Cloudflare
 *   D1_DATABASE_NAME        tên database D1 (ví dụ: fwbb-standby)
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dumpToSql } from "./dump-to-sql.mjs";

/**
 * Ghim bản wrangler. Bản mới ra vài ngày một lần; để `latest` thì một hôm nào
 * đó nó đổi hành vi và việc sao lưu hỏng mà không ai đụng vào gì.
 */
const WRANGLER = "wrangler@4.151.0";

function die(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const dumpArg = args.find((a) => a.startsWith("--dump="));

if (!dumpArg) die("Thiếu --dump=<file.json>.");
const dumpPath = dumpArg.slice("--dump=".length);

const dbName = process.env.D1_DATABASE_NAME;
if (!dbName) die("Thiếu D1_DATABASE_NAME.");
if (!process.env.CLOUDFLARE_API_TOKEN) die("Thiếu CLOUDFLARE_API_TOKEN.");
if (!process.env.CLOUDFLARE_ACCOUNT_ID) die("Thiếu CLOUDFLARE_ACCOUNT_ID.");

const sql = dumpToSql(JSON.parse(readFileSync(dumpPath, "utf8")));

if (!APPLY) {
  console.log(
    `\n🔍 Chạy thử. Sẽ đẩy ${sql.length} ký tự SQL vào D1 "${dbName}".\n` +
      `   Thêm --apply để làm thật.\n`,
  );
  process.exit(0);
}

// File .sql này là dữ liệu cá nhân dạng đọc được. Thư mục tạm riêng, xoá ở
// `finally` kể cả khi wrangler chết giữa chừng.
const dir = mkdtempSync(join(tmpdir(), "fwbb-d1-"));
const sqlPath = join(dir, "snapshot.sql");
try {
  writeFileSync(sqlPath, sql);
  const r = spawnSync(
    "npx",
    [
      "-y",
      WRANGLER,
      "d1",
      "execute",
      dbName,
      "--remote",
      `--file=${sqlPath}`,
      "--yes",
    ],
    { stdio: "inherit", shell: process.platform === "win32" },
  );
  if (r.status !== 0) die("wrangler báo lỗi khi nạp vào D1.");
  console.log(`\n✅ D1 "${dbName}" đã khớp với bản chụp.\n`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

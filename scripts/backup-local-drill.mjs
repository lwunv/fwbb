/**
 * Diễn tập bản sao lưu để ở máy: chứng minh nó khôi phục được, không chỉ ghi được.
 *
 * Một bản sao lưu chưa từng khôi phục thử thì chỉ là một file. Bài này chạy
 * TRỌN đường đi trên một database giả, rồi so từng bit:
 *
 *   ghi bản đầy đủ → sửa dữ liệu → ghi phần chênh → đọc lại cả chuỗi từ đĩa
 *   → nạp vào một database trống → so với bản gốc
 *
 * Chạy: node scripts/backup-local-drill.mjs
 *
 * ⚠️ KHÔNG đụng database thật. Nó tự ép `TURSO_DATABASE_URL` sang bản sao của
 * `e2e/local.db`, nên không có đường nào nó tìm về prod.
 * ⚠️ Có ghi plaintext ra thư mục tạm ở bước nạp lại, và tự xoá ở cuối.
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createClient } from "@libsql/client";

const PASS = "mat-khau-dien-tap-khong-phai-that";
const work = mkdtempSync(join(tmpdir(), "fwbb-drill-"));
const sim = join(work, "sim.db");
const bk = join(work, "bk");
const out = join(work, "lay-ra.json");
const target = join(work, "khoi-phuc.db");

/** Mọi lệnh con đều thừa hưởng env đã ép sang database giả. */
const env = {
  ...process.env,
  BACKUP_PASSPHRASE: PASS,
  TURSO_DATABASE_URL: `file:${sim}`,
  TURSO_AUTH_TOKEN: "",
};

function step(n, title) {
  console.log(`\n── ${n}. ${title}`);
}

function node(script, args = [], extraEnv = {}) {
  return execFileSync(process.execPath, [script, ...args], {
    env: { ...env, ...extraEnv },
    encoding: "utf8",
  });
}

let failed = false;
function check(ok, msg) {
  console.log(`   ${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) failed = true;
}

try {
  if (!existsSync("e2e/local.db")) {
    console.error("❌ Không thấy e2e/local.db để làm dữ liệu giả. Chạy từ thư mục gốc dự án.");
    process.exit(1);
  }
  copyFileSync("e2e/local.db", sim);
  console.log(`🧪 DIỄN TẬP SAO LƯU Ở MÁY\n   Thư mục tạm: ${work}`);

  step(1, "ghi bản đầy đủ");
  const full = node("scripts/backup-local.mjs", [`--dir=${bk}`]);
  check(/Bản đầy đủ/.test(full), "đã ghi một bản đầy đủ");
  check(/khớp từng bit/.test(full), "tự kiểm lại từ đĩa ngay sau khi ghi");

  step(2, "sửa dữ liệu: thêm một người, sửa một người, xoá ba lượt vote");
  const c = createClient({ url: `file:${sim}` });
  await c.execute("INSERT INTO members (name, is_active, approval_status) VALUES ('Nguoi Dien Tap', 1, 'approved')");
  await c.execute("UPDATE members SET nickname='da-sua' WHERE id=(SELECT MIN(id) FROM members)");
  await c.execute("DELETE FROM votes WHERE id IN (SELECT id FROM votes LIMIT 3)");
  c.close();
  console.log("   xong");

  step(3, "ghi phần chênh");
  const patch = node("scripts/backup-local.mjs", [`--dir=${bk}`]);
  check(/Phần chênh/.test(patch), "ghi phần chênh chứ không ghi lại cả bản");
  check(/khớp từng bit/.test(patch), "dựng lại cả chuỗi từ đĩa vẫn khớp");

  step(4, "đọc lại cả chuỗi, lấy dữ liệu ra");
  const restored = node("scripts/restore-local.mjs", [`--dir=${bk}`, `--out=${out}`]);
  check(/Mở và dựng lại được/.test(restored), "mở được bản niêm và dựng lại");

  step(5, "nạp vào một database trống rồi so từng bit với bản gốc");
  node("node_modules/drizzle-kit/bin.cjs", ["migrate", "--config=drizzle.standby.config.ts"], {
    STANDBY_DATABASE_URL: `file:${target}`,
    // drizzle-kit bắt buộc có token kể cả với database dạng file; libsql bỏ qua nó.
    STANDBY_AUTH_TOKEN: "khong-dung-voi-db-dang-file",
  });
  node("scripts/restore-db.mjs", [out, `--target=file:${target}`, "--apply"]);
  const cmp = execFileSync(process.execPath, ["scripts/compare-db.mjs"], {
    env: { ...env, A_URL: `file:${sim}`, B_URL: `file:${target}` },
    encoding: "utf8",
  });
  check(/KHOP TUNG BIT/.test(cmp), cmp.trim().split("\n").pop());

  step(6, "xoá plaintext của bài diễn tập");
  rmSync(out, { force: true });
  check(!existsSync(out), "đã xoá file plaintext");
} finally {
  // Dọn thư mục tạm là việc cho gọn, KHÔNG phải tiêu chí đạt/hỏng. Windows
  // hay còn giữ khoá file sqlite thêm một lúc sau khi đóng kết nối, và để
  // chuyện đó làm đỏ bài diễn tập thì lần sau không ai tin kết quả nữa.
  // Phần plaintext có PII đã được xoá riêng ở bước 6, không dựa vào đây.
  try {
    rmSync(work, { recursive: true, force: true });
  } catch (e) {
    console.log(`   (chưa xoá được thư mục tạm ${work}: ${e.code}. Xoá tay khi rảnh.)`);
  }
}

console.log(failed ? "\n❌ DIỄN TẬP HỎNG — đừng tin bản sao lưu cho tới khi sửa xong.\n" : "\n✅ DIỄN TẬP ĐẠT — bản sao lưu ở máy khôi phục được.\n");
process.exit(failed ? 1 : 0);

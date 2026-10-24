/**
 * Khôi phục một bản dump của `backup-db.mjs` vào MỘT database libsql bất kỳ.
 *
 * Đây là nửa còn thiếu của việc sao lưu: một bản sao lưu chưa từng khôi phục
 * thử thì chưa phải sao lưu, chỉ là một file.
 *
 * Chạy:
 *   node scripts/restore-db.mjs <file.json> --target=file:/duong/dan.db
 *     → chạy THỬ, chỉ in ra sẽ làm gì, không ghi gì cả
 *
 *   node scripts/restore-db.mjs <file.json> --target=file:/duong/dan.db --apply
 *     → ghi thật
 *
 * ━━━ BA CHỐT CHẶN AN TOÀN ━━━
 * 1. Đích phải truyền TƯỜNG MINH qua `--target=`. Script này KHÔNG bao giờ đọc
 *    `.env.local`, nên không có đường nào nó tự trỏ vào database thật.
 * 2. Mặc định là chạy thử. Muốn ghi phải thêm `--apply`.
 * 3. Đích KHÔNG phải `file:` (tức là một database từ xa đang chạy thật) thì
 *    phải thêm `--remote-i-am-sure`. Khôi phục là thao tác XOÁ SẠCH RỒI GHI
 *    LẠI; bắn nhầm vào database đang sống là mất dữ liệu.
 *
 * Bản dump KHÔNG chứa cấu trúc bảng, chỉ chứa dữ liệu. Nên database đích phải
 * được chạy migration trước. Script sẽ kiểm và dừng nếu thiếu bảng.
 */

import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const dumpPath = args.find((a) => !a.startsWith("--"));
const targetArg = args.find((a) => a.startsWith("--target="));
const APPLY = args.includes("--apply");
const REMOTE_OK = args.includes("--remote-i-am-sure");

function die(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

if (!dumpPath) die("Thiếu đường dẫn file dump.");
if (!targetArg) {
  die(
    "Thiếu --target=<url>. Cố ý bắt khai báo tường minh để không ai lỡ tay " +
      "khôi phục đè lên database thật.",
  );
}
const target = targetArg.slice("--target=".length);
const isFile = target.startsWith("file:");
if (!isFile && !REMOTE_OK) {
  die(
    `Đích "${target}" không phải file cục bộ. Khôi phục là XOÁ SẠCH RỒI GHI ` +
      `LẠI. Nếu thật sự muốn, thêm --remote-i-am-sure.`,
  );
}

const dump = JSON.parse(readFileSync(dumpPath, "utf8"));
if (!dump?.tables || typeof dump.tables !== "object") {
  die("File không đúng định dạng dump (thiếu khoá `tables`).");
}

const client = createClient({
  url: target,
  authToken: process.env.RESTORE_TARGET_TOKEN,
});

console.log(`\n♻️  KHÔI PHỤC DATABASE`);
console.log(`Nguồn:  ${dumpPath}`);
console.log(`Chụp lúc: ${dump.meta?.takenAt ?? "không rõ"}`);
console.log(`Đích:   ${target}`);
console.log(`Chế độ: ${APPLY ? "GHI THẬT" : "chạy thử (không ghi gì)"}\n`);

// ─── Kiểm cấu trúc đích ──────────────────────────────────────────────────
const existing = new Set(
  (
    await client.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
    )
  ).rows.map((r) => String(r.name)),
);

const dumpTables = Object.keys(dump.tables);
const missing = dumpTables.filter((t) => !existing.has(t));
if (missing.length > 0) {
  die(
    `Database đích thiếu ${missing.length} bảng: ${missing.join(", ")}.\n` +
      `   Chạy migration cho đích trước rồi khôi phục lại.`,
  );
}

// ─── Thứ tự chèn theo khoá ngoại ─────────────────────────────────────────
// Bảng con phải chèn SAU bảng cha, và xoá thì ngược lại. Sắp topo từ
// PRAGMA foreign_key_list thay vì đoán, vì đoán sai là lỗi khoá ngoại giữa
// chừng và khôi phục dở dang.
const parents = new Map();
for (const t of dumpTables) {
  const fks = await client.execute(`PRAGMA foreign_key_list("${t}")`);
  const ps = new Set(
    fks.rows
      .map((r) => String(r.table))
      .filter((p) => p !== t && dumpTables.includes(p)),
  );
  parents.set(t, ps);
}

const order = [];
const seen = new Set();
const visiting = new Set();
function visit(t) {
  if (seen.has(t)) return;
  if (visiting.has(t)) return; // vòng lặp khoá ngoại: bỏ qua, chèn theo thứ tự gặp
  visiting.add(t);
  for (const p of parents.get(t) ?? []) visit(p);
  visiting.delete(t);
  seen.add(t);
  order.push(t);
}
for (const t of dumpTables) visit(t);

console.log("Thứ tự chèn (cha trước con):");
console.log("  " + order.join(" → ") + "\n");

let total = 0;
for (const t of order) total += dump.tables[t].length;
console.log(`Sẽ xoá sạch và ghi lại ${total} dòng / ${order.length} bảng.`);

if (!APPLY) {
  for (const t of order) {
    const now = await client.execute(`SELECT COUNT(*) AS n FROM "${t}"`);
    console.log(
      `  ${t.padEnd(34)} đích đang có ${String(now.rows[0].n).padStart(6)} → sẽ thành ${String(dump.tables[t].length).padStart(6)}`,
    );
  }
  console.log(`\n⚠️  Mới chỉ chạy thử. Thêm --apply để ghi thật.\n`);
  client.close();
  process.exit(0);
}

// ─── Ghi thật, trong MỘT giao dịch ───────────────────────────────────────
// Tất cả hoặc không gì cả. Hỏng giữa chừng mà vẫn giữ lại phần đã ghi thì
// database rơi vào trạng thái nửa vời, tệ hơn là chưa khôi phục.
const tx = await client.transaction("write");
try {
  for (const t of [...order].reverse()) {
    await tx.execute(`DELETE FROM "${t}"`);
  }

  for (const t of order) {
    const rows = dump.tables[t];
    if (rows.length === 0) continue;
    const cols = Object.keys(rows[0]);
    const colList = cols.map((c) => `"${c}"`).join(", ");
    const placeholders = cols.map(() => "?").join(", ");
    const sql = `INSERT INTO "${t}" (${colList}) VALUES (${placeholders})`;
    for (const row of rows) {
      await tx.execute({ sql, args: cols.map((c) => row[c] ?? null) });
    }
    console.log(`  ✓ ${t.padEnd(34)} ${String(rows.length).padStart(6)} dòng`);
  }

  await tx.commit();
} catch (e) {
  await tx.rollback();
  die(`Khôi phục thất bại, đã hoàn tác toàn bộ: ${e.message}`);
}

// ─── Đối chiếu sau khi ghi ───────────────────────────────────────────────
// Báo "xong" mà không đếm lại thì không biết có xong thật không.
let mismatch = 0;
for (const t of order) {
  const got = Number(
    (await client.execute(`SELECT COUNT(*) AS n FROM "${t}"`)).rows[0].n,
  );
  const want = dump.tables[t].length;
  if (got !== want) {
    console.error(`  ✗ ${t}: đích có ${got} dòng, bản dump có ${want}`);
    mismatch += 1;
  }
}

client.close();
if (mismatch > 0) {
  die(`${mismatch} bảng lệch số dòng sau khi khôi phục.`);
}
console.log(`\n✅ Khôi phục xong, ${total} dòng, mọi bảng khớp số dòng.\n`);

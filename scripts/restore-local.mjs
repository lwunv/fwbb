/**
 * Đọc lại bản sao lưu để ở máy: xem có gì, và lấy dữ liệu ra khi cần.
 *
 * Một bản sao lưu chưa từng mở thử thì chưa phải sao lưu, chỉ là một file. Đây
 * là nửa còn lại của `backup-local.mjs`.
 *
 * Chạy:
 *   node scripts/restore-local.mjs
 *       → liệt kê những bản đang giữ, dựng thử bản gần nhất, KHÔNG ghi gì
 *
 *   node scripts/restore-local.mjs --at=2026-11-03
 *       → dựng lại đúng trạng thái tới mốc đó
 *
 *   node scripts/restore-local.mjs --out=d:/tmp/lay-ra.json
 *       → ghi bản dump ra file để đưa cho `restore-db.mjs`
 *
 * ⚠️ `--out` ghi ra PLAINTEXT có PII thật (tên, email, số điện thoại, số tài
 * khoản, hash mật khẩu). Cố ý bắt khai tường minh, và cố ý KHÔNG có mặc định:
 * ghi loại dữ liệu này xuống đĩa phải là một việc có chủ ý. Dùng xong thì xoá.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { applyPatch, snapshotHash, unseal, pickBaseAndChain } from "./backup-local-core.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).split("=").slice(1).join("=");

const DIR = opt("dir", "D:/FWBB-Backups");
const AT = opt("at", "");
const OUT = opt("out", "");
const INDEX = join(DIR, "index.json");
const KEYFILE = join(DIR, "key.dpapi");
const ESCROW = join(DIR, "key.escrow.enc");

function die(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

if (!existsSync(INDEX)) die(`Chưa có sổ mục lục ở ${INDEX}. Chạy backup-local.mjs trước.`);

function dpapiKey() {
  return execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Add-Type -AssemblyName System.Security;" +
        "[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($env:FWBB_P),$null,'CurrentUser'))",
    ],
    { env: { ...process.env, FWBB_P: KEYFILE }, encoding: "utf8" },
  ).trim();
}

/**
 * Những khoá có thể mở được thư mục này, theo thứ tự thử.
 *
 * Có nhiều hơn một đường là CỐ Ý. Bản chép sang ổ ngoài hay thư mục đồng bộ
 * đám mây được niêm bằng khoá DPAPI của máy gốc, mà lúc cần đến nó thì máy gốc
 * thường đã không còn. `key.escrow.enc` là chính khoá đó, gói kín bằng
 * `BACKUP_PASSPHRASE`, nên ở máy nào cũng mở ra được.
 */
function ungVienKhoa() {
  const env = process.env.BACKUP_PASSPHRASE;
  const ds = [];
  if (env) ds.push({ how: "BACKUP_PASSPHRASE", lay: () => env });
  if (existsSync(KEYFILE) && process.platform === "win32") {
    ds.push({ how: "khoá DPAPI của máy này", lay: dpapiKey });
  }
  if (env && existsSync(ESCROW)) {
    ds.push({ how: "khoá gửi kèm, mở bằng BACKUP_PASSPHRASE", lay: () => unseal(readFileSync(ESCROW), env).key });
  }
  return ds;
}

/** Thử từng khoá lên đúng file đầu chuỗi, lấy cái nào mở được. */
function moKhoa(file) {
  const ds = ungVienKhoa();
  if (!ds.length) {
    die(`Không có BACKUP_PASSPHRASE, không thấy khoá ${KEYFILE}, cũng không thấy ${ESCROW}.`);
  }
  const buf = readFileSync(file);
  const loi = [];
  for (const c of ds) {
    try {
      const pass = c.lay();
      unseal(buf, pass);
      return { pass, how: c.how };
    } catch (e) {
      loi.push(`  ${c.how}: ${e.message}`);
    }
  }
  die(`Không khoá nào mở được ${file}:\n${loi.join("\n")}`);
}

const idx = JSON.parse(readFileSync(INDEX, "utf8"));
if (!idx.files?.length) die("Sổ mục lục rỗng.");

console.log(`\n🗄  BẢN SAO LƯU Ở MÁY — ${DIR}\n`);
for (const f of idx.files) {
  const loai = f.kind === "full" ? "đầy đủ" : "phần chênh";
  console.log(
    `  ${f.takenAt.slice(0, 19).replace("T", " ")}  ${loai.padEnd(10)} ${String((f.bytes / 1024).toFixed(1)).padStart(8)} KB  ${f.hash.slice(0, 12)}`,
  );
}

// Mốc `--at=2026-11-03` hiểu là "hết ngày đó", nếu không thì người dùng gõ
// đúng ngày có bản sao lưu vẫn bị cắt mất chính bản đó.
const upto = AT ? (AT.length === 10 ? `${AT}T23:59:59.999Z` : AT) : null;
const chain = pickBaseAndChain(idx.files, upto);
console.log(
  `\nDựng lại ${upto ? `tới ${upto.slice(0, 10)}` : "bản gần nhất"}: 1 bản đầy đủ + ${chain.length - 1} phần chênh.`,
);

const { pass, how } = moKhoa(join(DIR, chain[0].name));
console.log(`Mở bằng: ${how}.`);
let snap = unseal(readFileSync(join(DIR, chain[0].name)), pass);
for (const f of chain.slice(1)) snap = applyPatch(snap, unseal(readFileSync(join(DIR, f.name)), pass));

const got = snapshotHash(snap);
const want = chain[chain.length - 1].hash;
if (got !== want) die(`Vân tay không khớp sổ mục lục (chờ ${want.slice(0, 12)}, ra ${got.slice(0, 12)}).`);

let total = 0;
console.log("");
for (const [t, rows] of Object.entries(snap.tables)) {
  total += rows.length;
  console.log(`  ${t.padEnd(34)} ${String(rows.length).padStart(6)} dòng`);
}
console.log(`\n✅ Mở và dựng lại được ${total} dòng / ${Object.keys(snap.tables).length} bảng (${got.slice(0, 12)}).`);
console.log(`   Chụp lúc: ${snap.meta.takenAt}`);

if (OUT) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ meta: snap.meta, tables: snap.tables }, null, 2), "utf8");
  console.log(`\n⚠️  Đã ghi PLAINTEXT có PII ra ${OUT}. Dùng xong hãy xoá.`);
  console.log(`   Nạp vào một database trống để xem:`);
  console.log(`   node scripts/restore-db.mjs ${OUT} --target=file:d:/tmp/thu.db --apply`);
} else {
  console.log(`\n(Chưa ghi gì ra đĩa. Thêm --out=<file> nếu cần lấy dữ liệu ra.)`);
}

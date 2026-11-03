/**
 * Sao lưu database về MÁY NÀY, đã niêm phong, chạy được không cần ai bấm.
 *
 * Vì sao cần, dù đã có bản sao lưu chạy trên GitHub: cả hai thứ kia đều nằm
 * sau một tài khoản của người khác. Turso khoá tài khoản thì KHÔNG XUẤT ĐƯỢC
 * DỮ LIỆU RA (đúng chuyện đã xảy ra ngày 24/10/2026), còn bản trên GitHub thì
 * hết hạn sau 90 ngày. Bản ở máy không phụ thuộc hai chỗ đó.
 *
 * Chạy:
 *   node scripts/backup-local.mjs                  ghi thêm một bản cho hôm nay
 *   node scripts/backup-local.mjs --full           ép ghi bản đầy đủ
 *   node scripts/backup-local.mjs --dir=E:/noi-khac
 *
 * Mặc định nó ghi PHẦN CHÊNH so với bản gần nhất, nên mỗi ngày chỉ tốn vài KB
 * thay vì cả bản. Tự ghi lại bản đầy đủ khi chuỗi chênh đã dài, để lúc khôi
 * phục không phải nối quá nhiều mắt xích.
 *
 * ⚠️ CHỈ ĐỌC database. Không câu lệnh nào ghi.
 * ⚠️ Không bao giờ ghi bản chưa niêm xuống đĩa: dữ liệu là PII thật.
 */

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { createClient } from "@libsql/client";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { diffSnapshots, applyPatch, snapshotHash, seal, unseal, pickBaseAndChain } from "./backup-local-core.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).split("=").slice(1).join("=");

const DIR = opt("dir", "D:/FWBB-Backups");
const KEEP_FULLS = Number(opt("keep", "4"));
/** Chuỗi chênh dài quá thì khôi phục phải nối nhiều mắt xích, mà mắt nào hỏng
 *  là hỏng cả chuỗi. Cứ hai tuần ghi lại một bản đầy đủ cho chắc. */
const MAX_CHAIN = Number(opt("max-chain", "14"));
const INDEX = join(DIR, "index.json");
const KEYFILE = join(DIR, "key.dpapi");

/* ─────────────────────────── mật khẩu niêm ─────────────────────────── */

/**
 * Lấy mật khẩu niêm, theo thứ tự ưu tiên:
 *
 * 1. `BACKUP_PASSPHRASE` nếu có. Dùng cái này thì file mở được ở BẤT KỲ máy
 *    nào, giống hệt bản sao lưu chạy trên GitHub. Nên dùng khi muốn mang file
 *    đi nơi khác.
 * 2. Nếu không có: tự sinh một khoá ngẫu nhiên, cất bằng DPAPI của Windows.
 *    Ưu điểm là chạy tự động hằng ngày mà không phải cất mật khẩu ở đâu cả.
 *    ĐÁNH ĐỔI: khoá đó gắn với tài khoản Windows này. Mất máy hoặc mất
 *    profile là mở không ra. Nên đây chỉ là lớp tiện, KHÔNG phải lớp duy nhất.
 */
function getPassphrase() {
  const fromEnv = process.env.BACKUP_PASSPHRASE;
  if (fromEnv) return { pass: fromEnv, how: "BACKUP_PASSPHRASE" };

  if (process.platform !== "win32") {
    throw new Error("Ngoài Windows thì phải tự khai BACKUP_PASSPHRASE (không có DPAPI để cất khoá).");
  }

  const ps = (script, env) =>
    execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
      env: { ...process.env, ...env },
      encoding: "utf8",
    }).trim();

  if (!existsSync(KEYFILE)) {
    mkdirSync(DIR, { recursive: true });
    ps(
      "Add-Type -AssemblyName System.Security;" +
        "$b=[Convert]::FromBase64String($env:FWBB_K);" +
        "[IO.File]::WriteAllBytes($env:FWBB_P,[Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser'))",
      { FWBB_K: randomBytes(32).toString("base64"), FWBB_P: KEYFILE },
    );
    console.log(`🔑 Đã tạo khoá niêm mới, cất bằng Windows DPAPI: ${KEYFILE}`);
  }

  const pass = ps(
    "Add-Type -AssemblyName System.Security;" +
      "[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($env:FWBB_P),$null,'CurrentUser'))",
    { FWBB_P: KEYFILE },
  );
  if (!pass) throw new Error(`Mở khoá DPAPI không ra gì: ${KEYFILE}`);
  return { pass, how: "khoá DPAPI của máy" };
}

/* ───────────────────────────── sổ mục lục ───────────────────────────── */

/** Sổ mục lục chỉ chứa tên file, thời điểm và vân tay. KHÔNG có dữ liệu. */
const readIndex = () => (existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, "utf8")) : { files: [] });
const writeIndex = (idx) => writeFileSync(INDEX, JSON.stringify(idx, null, 2), "utf8");

/* ──────────────────────────── đọc database ──────────────────────────── */

async function dumpLive() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("Thiếu TURSO_DATABASE_URL trong .env.local");
  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    // Bỏ `replica_state` và `replica_sync`: chúng là CỜ ĐIỀU KHIỂN của việc
    // chuyển sang bản dự phòng, chỉ có nghĩa trên đúng database đang giữ
    // chúng. Chép đi nơi khác là cả cụm quay lại vòng luẩn quẩn.
    const names = (
      await client.execute(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream%' AND name NOT LIKE '__drizzle%' AND name NOT IN ('replica_state','replica_sync') ORDER BY name`,
      )
    ).rows.map((r) => String(r.name));

    const tables = {};
    let total = 0;
    for (const t of names) {
      const res = await client.execute(`SELECT * FROM "${t}"`);
      tables[t] = res.rows.map((row) => {
        const o = {};
        for (const c of res.columns) {
          const v = row[c];
          o[c] = typeof v === "bigint" ? Number(v) : v;
        }
        return o;
      });
      total += tables[t].length;
    }
    return {
      snapshot: { meta: { database: url, takenAt: new Date().toISOString(), tableCount: names.length }, tables },
      total,
    };
  } finally {
    client.close();
  }
}

/** Dựng lại bản chụp gần nhất từ các file đã có trên đĩa. */
function rebuildLatest(idx, pass) {
  const chain = pickBaseAndChain(idx.files);
  let snap = unseal(readFileSync(join(DIR, chain[0].name)), pass);
  for (const f of chain.slice(1)) snap = applyPatch(snap, unseal(readFileSync(join(DIR, f.name)), pass));
  return { snap, chainLen: chain.length - 1 };
}

/* ───────────────────────────────── chạy ───────────────────────────────── */

mkdirSync(DIR, { recursive: true });
const { pass, how } = getPassphrase();
const idx = readIndex();

console.log(`\n📦 SAO LƯU VỀ MÁY`);
console.log(`Thư mục: ${DIR}`);
console.log(`Niêm bằng: ${how}\n`);

const { snapshot, total } = await dumpLive();
console.log(`Đã đọc ${total} dòng / ${snapshot.meta.tableCount} bảng.`);

// Chốt chặn báo-xanh-nhầm: một bản dump rỗng mà vẫn ghi đè lên lịch sử là
// cách nhanh nhất để mất sạch. Thà hỏng ồn ào còn hơn hỏng im lặng.
if (total === 0 || snapshot.meta.tableCount === 0) {
  console.error("❌ Dump rỗng. KHÔNG ghi gì cả.");
  process.exit(1);
}

let prev = null;
let chainLen = 0;
if (idx.files.length > 0) {
  try {
    const r = rebuildLatest(idx, pass);
    prev = r.snap;
    chainLen = r.chainLen;
  } catch (e) {
    console.warn(`⚠️  Không dựng lại được bản cũ (${e.message}). Sẽ ghi một bản đầy đủ mới.`);
  }
}

const liveHash = snapshotHash(snapshot);
if (prev && snapshotHash(prev) === liveHash) {
  console.log("✓ Không có gì đổi so với bản gần nhất. Không ghi thêm file.");
  process.exit(0);
}

const forceFull = flag("full") || !prev || chainLen >= MAX_CHAIN;
const stamp = snapshot.meta.takenAt.replace(/[:.]/g, "-").slice(0, 19);
const kind = forceFull ? "full" : "patch";
const name = `fwbb-${stamp}.${kind}.enc`;
const payload = forceFull ? { kind: "full", hash: liveHash, ...snapshot } : diffSnapshots(prev, snapshot);

writeFileSync(join(DIR, name), seal(payload, pass));

const entry = {
  name,
  kind,
  takenAt: snapshot.meta.takenAt,
  hash: liveHash,
  ...(forceFull ? {} : { baseHash: payload.baseHash, changedTables: payload.changedTables }),
  bytes: readFileSync(join(DIR, name)).length,
};
idx.files.push(entry);
writeIndex(idx);

console.log(`${forceFull ? "📁 Bản đầy đủ" : "➕ Phần chênh"}: ${name} (${(entry.bytes / 1024).toFixed(1)} KB)`);
if (!forceFull) console.log(`   ${payload.changedTables} bảng có thay đổi, nối sau ${chainLen} bản chênh trước đó.`);

/* ─── Kiểm lại từ ĐĨA, không tin bộ nhớ ─── */
const check = rebuildLatest(readIndex(), pass);
if (snapshotHash(check.snap) !== liveHash) {
  console.error("❌ Dựng lại từ đĩa KHÔNG khớp dữ liệu vừa đọc. Bản sao lưu này không dùng được.");
  process.exit(1);
}
console.log(`✅ Đã kiểm: dựng lại từ đĩa khớp từng bit (${liveHash.slice(0, 12)}).`);

/* ─── Dọn bản cũ: giữ vài bản đầy đủ gần nhất cùng chuỗi chênh của chúng ─── */
const fullsAsc = idx.files.filter((f) => f.kind === "full").map((f) => f.takenAt).sort();
if (fullsAsc.length > KEEP_FULLS) {
  const cutoff = fullsAsc[fullsAsc.length - KEEP_FULLS];
  const drop = idx.files.filter((f) => f.takenAt < cutoff);
  for (const f of drop) {
    try {
      unlinkSync(join(DIR, f.name));
    } catch {
      /* file đã bị xoá tay rồi thì thôi, không phải lỗi */
    }
  }
  idx.files = idx.files.filter((f) => f.takenAt >= cutoff);
  writeIndex(idx);
  if (drop.length) console.log(`🧹 Dọn ${drop.length} file cũ hơn ${cutoff.slice(0, 10)}.`);
}

const onDisk = readdirSync(DIR).filter((f) => f.endsWith(".enc")).length;
console.log(`\nĐang giữ ${onDisk} file sao lưu trong ${DIR}.`);

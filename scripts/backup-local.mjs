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
 *   node scripts/backup-local.mjs --mirror=E:/FWBB  chép thêm sang chỗ thứ hai
 *   node scripts/backup-local.mjs --escrow         gói khoá để mở được ở máy khác
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
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, copyFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import {
  diffSnapshots,
  applyPatch,
  snapshotHash,
  seal,
  unseal,
  pickBaseAndChain,
  planMirror,
} from "./backup-local-core.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).split("=").slice(1).join("=");

const DIR = opt("dir", "D:/FWBB-Backups");
const KEEP_FULLS = Number(opt("keep", "4"));
/** Chuỗi chênh dài quá thì khôi phục phải nối nhiều mắt xích, mà mắt nào hỏng
 *  là hỏng cả chuỗi. Cứ hai tuần ghi lại một bản đầy đủ cho chắc. */
const MAX_CHAIN = Number(opt("max-chain", "14"));
/** Chỗ thứ hai để chép bản niêm sang: ổ ngoài, hoặc thư mục đồng bộ đám mây. */
const MIRROR = opt("mirror", "");
const INDEX = join(DIR, "index.json");
const KEYFILE = join(DIR, "key.dpapi");
const ESCROW_NAME = "key.escrow.enc";
const ESCROW = join(DIR, ESCROW_NAME);

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
  // Thư mục đã có khoá DPAPI thì mọi file cũ trong đó đang niêm bằng chính nó.
  // Ưu tiên BACKUP_PASSPHRASE ở đây là ghi bản mới bằng một khoá khác: đọc
  // không ra bản cũ, nó ghi một bản đầy đủ mới, và chuỗi gãy làm đôi mà chỉ
  // báo một dòng cảnh báo. Đã dính đúng lỗi này ngày 03/11/2026 lúc diễn tập.
  // Muốn mở được ở máy khác thì dùng `--escrow`, không phải đổi khoá giữa chừng.
  if (process.platform === "win32" && existsSync(KEYFILE)) {
    const cu = dpapiKey();
    if (!cu) throw new Error(`Mở khoá DPAPI không ra gì: ${KEYFILE}`);
    return { pass: cu, how: "khoá DPAPI của máy" };
  }

  const fromEnv = process.env.BACKUP_PASSPHRASE;
  if (fromEnv) return { pass: fromEnv, how: "BACKUP_PASSPHRASE" };

  const pass = dpapiKey({ create: true });
  if (!pass) throw new Error(`Mở khoá DPAPI không ra gì: ${KEYFILE}`);
  return { pass, how: "khoá DPAPI của máy" };
}

/**
 * Khoá ngẫu nhiên do máy này giữ, cất bằng DPAPI theo tài khoản Windows.
 * Trả về `null` nếu chưa có khoá và cũng không được phép tạo mới.
 */
function dpapiKey({ create = false } = {}) {
  if (process.platform !== "win32") {
    throw new Error("Ngoài Windows thì phải tự khai BACKUP_PASSPHRASE (không có DPAPI để cất khoá).");
  }

  const ps = (script, env) =>
    execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
      env: { ...process.env, ...env },
      encoding: "utf8",
    }).trim();

  if (!existsSync(KEYFILE)) {
    if (!create) return null;
    mkdirSync(DIR, { recursive: true });
    ps(
      "Add-Type -AssemblyName System.Security;" +
        "$b=[Convert]::FromBase64String($env:FWBB_K);" +
        "[IO.File]::WriteAllBytes($env:FWBB_P,[Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser'))",
      { FWBB_K: randomBytes(32).toString("base64"), FWBB_P: KEYFILE },
    );
    console.log(`🔑 Đã tạo khoá niêm mới, cất bằng Windows DPAPI: ${KEYFILE}`);
  }

  return ps(
    "Add-Type -AssemblyName System.Security;" +
      "[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($env:FWBB_P),$null,'CurrentUser'))",
    { FWBB_P: KEYFILE },
  );
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

/* ────────────────────── chép sang chỗ thứ hai ────────────────────── */

const HUONG_DAN = `KHOI PHUC TU THU MUC NAY
========================

Day la ban sao luu database FWBB, da nien phong (AES-256-GCM). Khong doc
truc tiep duoc, va khong co cach nao doc neu khong co mat khau.

Can: ma nguon FWBB (github.com/lwunv/FWBB) va Node.js.

  1) Dat mat khau sao luu vao bien moi truong BACKUP_PASSPHRASE.
  2) node scripts/restore-local.mjs --dir="<thu muc nay>"
       -> liet ke nhung ban dang giu va dung thu ban gan nhat, khong ghi gi.
  3) node scripts/restore-local.mjs --dir="<thu muc nay>" --out=lay-ra.json
       -> ghi du lieu ra file. File do la PII THAT: dung xong phai xoa.

File ${ESCROW_NAME} la khoa nien, da duoc goi kin bang chinh
BACKUP_PASSPHRASE. Co no thi mo duoc ban sao luu nay o BAT KY may nao.
Thieu no thi chi mo duoc tren dung tai khoan Windows da tao ra ban sao luu.

File index.json chi la so muc luc (ten file, thoi diem, van tay). Khong co
du lieu trong do.
`;

/**
 * Chép bản niêm sang chỗ thứ hai rồi KIỂM LẠI TỪ BÊN KIA.
 *
 * Vì sao cần: cả bốn bản đầy đủ đang nằm trên đúng một cái ổ của đúng một cái
 * máy. Mất máy là mất sạch, mà đó chính là tình huống người ta cần bản sao
 * lưu nhất.
 *
 * Không xoá gì bên kia. Nguồn dọn bản cũ thì chỗ thứ hai vẫn giữ.
 */
function mirrorNow(idxNow, how) {
  if (!MIRROR) return;
  mkdirSync(MIRROR, { recursive: true });

  const sizes = {};
  for (const f of readdirSync(MIRROR)) {
    try {
      sizes[f] = statSync(join(MIRROR, f)).size;
    } catch {
      /* file bên kia đang bị khoá thì coi như chưa có, chép lại là xong */
    }
  }

  const todo = planMirror(idxNow.files, sizes);
  for (const n of todo) copyFileSync(join(DIR, n), join(MIRROR, n));

  // Ba file này đổi nội dung mà không đổi tên, nên luôn ghi đè.
  copyFileSync(INDEX, join(MIRROR, "index.json"));
  if (existsSync(ESCROW)) copyFileSync(ESCROW, join(MIRROR, ESCROW_NAME));
  writeFileSync(join(MIRROR, "CACH-KHOI-PHUC.txt"), HUONG_DAN, "utf8");

  // Đọc lại từ BÊN KIA. `copyFileSync` không ném lỗi không có nghĩa là bên kia
  // đã có đủ byte: thư mục đồng bộ đám mây và ổ cắm ngoài đều biết cách nuốt
  // một file dở dang mà không kêu.
  const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
  const hong = [];
  for (const f of idxNow.files) {
    let ben_kia = null;
    try {
      ben_kia = sha(join(MIRROR, f.name));
    } catch {
      /* không đọc được thì tính là hỏng, xử lý ngay dưới */
    }
    if (ben_kia !== sha(join(DIR, f.name))) hong.push(f.name);
  }

  if (hong.length) {
    console.error(`\n❌ Chép sang ${MIRROR} KHÔNG khớp: ${hong.join(", ")}`);
    console.error("   Bản ở máy đã ghi xong và kiểm đạt. Chỉ riêng bước chép sang chỗ thứ hai hỏng.");
    process.exit(1);
  }

  console.log(
    `📤 Chỗ thứ hai (${MIRROR}): chép thêm ${todo.length} file, kiểm lại ${idxNow.files.length} file khớp từng bit.`,
  );

  if (how !== "BACKUP_PASSPHRASE" && !existsSync(ESCROW)) {
    console.warn(`⚠️  Bản bên đó đang niêm bằng khoá DPAPI của MÁY NÀY, nên MẤT MÁY LÀ MỞ KHÔNG RA.`);
    console.warn(`   Chạy một lần duy nhất, có BACKUP_PASSPHRASE trong môi trường:`);
    console.warn(`   node scripts/backup-local.mjs --escrow`);
  }
}

/* ───────────────────────────────── chạy ───────────────────────────────── */

mkdirSync(DIR, { recursive: true });

/**
 * `--escrow`: gói khoá DPAPI lại bằng `BACKUP_PASSPHRASE` rồi cất cạnh bản sao
 * lưu. Chạy một lần là đủ.
 *
 * Đây là thứ biến bản chép đi từ trang trí thành dùng được thật. Khoá DPAPI
 * gắn với tài khoản Windows này; chép file niêm sang ổ ngoài mà không có
 * đường mở nào khác thì lúc mất máy vẫn trắng tay. Gói kín khoá bằng mật khẩu
 * người dùng tự nhớ sẽ tách được hai chuyện: chạy hằng ngày không cần gõ gì,
 * mà vẫn khôi phục được ở máy khác.
 */
if (flag("escrow")) {
  const ngoai = process.env.BACKUP_PASSPHRASE;
  if (!ngoai) {
    console.error("\n❌ Cần BACKUP_PASSPHRASE để gói khoá. Đặt nó vào môi trường rồi chạy lại.\n");
    process.exit(1);
  }
  const trong = dpapiKey();
  if (!trong) {
    console.error(`\n❌ Chưa có khoá DPAPI ở ${KEYFILE}. Chạy sao lưu một lần trước đã.\n`);
    process.exit(1);
  }
  writeFileSync(ESCROW, seal({ key: trong }, ngoai));
  // Mở lại ngay. Một file gói sai chỉ lộ ra đúng hôm cần đến nó.
  if (unseal(readFileSync(ESCROW), ngoai).key !== trong) {
    console.error("\n❌ Gói khoá xong mở lại không khớp. KHÔNG dùng file này.\n");
    process.exit(1);
  }
  console.log(`\n🔐 Đã gói khoá niêm vào ${ESCROW}, mở được bằng BACKUP_PASSPHRASE.`);
  console.log(`   Từ giờ bản sao lưu mở được ở máy khác, miễn là nhớ mật khẩu đó.\n`);
  process.exit(0);
}

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
  // Vẫn chép sang chỗ thứ hai: hôm qua chép hỏng mà hôm nay dữ liệu không đổi
  // thì nếu bỏ qua ở đây, nó hỏng im lặng cho tới lần có thay đổi tiếp theo.
  mirrorNow(idx, how);
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
console.log(`${forceFull ? "📁 Bản đầy đủ" : "➕ Phần chênh"}: ${name} (${(entry.bytes / 1024).toFixed(1)} KB)`);
if (!forceFull) console.log(`   ${payload.changedTables} bảng có thay đổi, nối sau ${chainLen} bản chênh trước đó.`);

/* ─── Kiểm lại từ ĐĨA rồi mới ghi vào sổ ─── */
// Thứ tự này quan trọng. Ghi sổ trước rồi mới kiểm là để lại một mắt xích
// hỏng nằm sẵn trong chuỗi, và lần sau đọc tới đó là gãy. Hỏng thì dọn luôn
// file vừa ghi và để sổ y nguyên, chuỗi cũ vẫn dùng được.
let loiKiem = null;
try {
  if (snapshotHash(rebuildLatest({ files: [...idx.files, entry] }, pass).snap) !== liveHash) {
    loiKiem = "dựng lại từ đĩa ra dữ liệu khác";
  }
} catch (e) {
  loiKiem = e.message;
}

if (loiKiem) {
  try {
    unlinkSync(join(DIR, name));
  } catch {
    /* không xoá được thì thôi, miễn là nó không nằm trong sổ */
  }
  console.error(`\n❌ Kiểm lại KHÔNG đạt: ${loiKiem}`);
  console.error("   Đã bỏ file vừa ghi. Sổ mục lục giữ nguyên, chuỗi cũ vẫn dùng được.");
  process.exit(1);
}

idx.files.push(entry);
writeIndex(idx);
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

mirrorNow(idx, how);

const onDisk = readdirSync(DIR).filter((f) => f.endsWith(".enc")).length;
console.log(`\nĐang giữ ${onDisk} file sao lưu trong ${DIR}.`);

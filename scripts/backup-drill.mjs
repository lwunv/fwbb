/**
 * Diễn tập trọn vòng: dump → mã hoá → giải mã → khôi phục → so từng bảng.
 *
 * Vì sao tồn tại: tới 01/11/2026, chuỗi sao lưu đã chạy hàng giờ suốt một
 * tuần nhưng CHƯA LẦN NÀO có ai mở một bản mã hoá ra và dựng lại database từ
 * nó. Một bản sao lưu chưa từng khôi phục thử không phải bản sao lưu, nó chỉ
 * là một file nhìn có vẻ yên tâm. Mấy thứ hỏng được mà không ai biết: tham số
 * openssl lệch giữa lúc mã hoá và lúc giải mã, dump mất kiểu dữ liệu (số lớn
 * thành chuỗi, blob thành rác), hoặc `restore-db.mjs` chèn thiếu cột.
 *
 * ━━━ KHÔNG ĐỤNG GÌ TỚI DỮ LIỆU THẬT ━━━
 * Script dựng database nguồn RIÊNG trong thư mục tạm, đổ dữ liệu bịa vào
 * (không có tên người, email hay số tài khoản thật), rồi khôi phục sang một
 * database tạm khác. Nó KHÔNG đọc `.env.local` và KHÔNG nhận `--target`, nên
 * không có đường nào nó chạm vào database thật. Mật khẩu mã hoá cũng là một
 * chuỗi ngẫu nhiên sinh tại chỗ, không phải `BACKUP_PASSPHRASE` thật.
 *
 * Điều nó CHỨNG MINH: scripts/backup-db.mjs, cặp tham số openssl trong
 * .github/workflows/backup-db.yml, và scripts/restore-db.mjs ghép lại với
 * nhau ra đúng dữ liệu ban đầu, từng bảng từng dòng.
 * Điều nó KHÔNG chứng minh: `BACKUP_PASSPHRASE` thật có đúng hay không. Chỉ
 * mở được một bản sao lưu thật mới trả lời được câu đó.
 *
 * Chạy:
 *   node scripts/backup-drill.mjs           → chạy và dọn sạch
 *   node scripts/backup-drill.mjs --keep    → giữ lại thư mục tạm để soi
 *
 * Mã thoát: 0 khớp hết, 1 có bảng lệch, 2 script chết giữa chừng.
 */

import { createClient } from "@libsql/client";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "src/db/migrations");

/** Bảng nào cũng hỏng được, nhưng thiếu mấy bảng này thì bài diễn tập vô nghĩa. */
const MUST_COVER = [
  "members",
  "sessions",
  "financial_transactions",
  "session_debts",
  "votes",
];

/** `file:` URL cần dấu gạch chéo xuôi, kể cả trên Windows. */
export function fileUrl(path) {
  return `file:${path.replace(/\\/g, "/")}`;
}

/**
 * Chuẩn hoá các dòng của một bảng về chuỗi để so sánh.
 *
 * Sắp xếp theo nội dung chứ không theo thứ tự trả về: khôi phục chèn lại theo
 * thứ tự trong dump, nhưng SQLite không hứa trả về đúng thứ tự đã chèn. So
 * sánh theo thứ tự thô sẽ đỏ nhầm.
 */
export function normalizeRows(rows) {
  return rows
    .map((row) => {
      const keys = Object.keys(row).sort();
      return JSON.stringify(
        keys.map((k) => {
          const v = row[k];
          // BigInt và Buffer không qua được JSON.stringify ở dạng có nghĩa.
          if (typeof v === "bigint") return [k, "bigint", v.toString()];
          if (v instanceof Uint8Array)
            return [k, "blob", Buffer.from(v).toString("hex")];
          return [k, typeof v, v];
        }),
      );
    })
    .sort();
}

/** Trả về danh sách khác biệt giữa hai bảng, mảng rỗng nghĩa là khớp. */
export function diffTables(name, before, after) {
  const a = normalizeRows(before);
  const b = normalizeRows(after);
  if (a.length !== b.length) {
    return [`${name}: ${a.length} dòng trước, ${b.length} dòng sau`];
  }
  const out = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      out.push(
        `${name}: dòng khác nhau\n    trước: ${a[i]}\n    sau:   ${b[i]}`,
      );
      if (out.length >= 3) break; // in vài dòng đầu là đủ để tìm nguyên nhân
    }
  }
  return out;
}

/**
 * Sinh một giá trị bịa cho một cột, dựa vào kiểu khai trong schema.
 *
 * `i` là số thứ tự dòng, dùng luôn làm phần phân biệt để không vướng UNIQUE.
 */
export function fakeValue(col, i, isForeignKey = false) {
  const type = String(col.type || "").toUpperCase();
  const name = col.name;
  if (col.pk) return i;
  // Cot khoa ngoai phai tro vao dong thu `i` cua bang cha. Nhan biet bang
  // PRAGMA foreign_key_list chu khong doan theo ten: `member_id_low` va
  // `member_id_high` deu tro vao members ma khong he ket thuc bang `_id`,
  // va dung cho do lam bai dien tap do oan mot lan (01/11/2026).
  if (isForeignKey) return i;
  if (type.includes("INT")) {
    // Cột cờ (is_active, ...) chỉ nhận 0/1; CHECK constraint sẽ chặn số khác.
    if (/^(is_|has_|use_|auto_)/.test(name) || name.endsWith("_confirmed")) {
      return i % 2;
    }
    return i * 1000 + 7;
  }
  if (type.includes("REAL") || type.includes("FLOA") || type.includes("DOUB")) {
    return i + 0.5;
  }
  if (type.includes("BLOB")) return Buffer.from(`blob-${i}`);
  // Chuỗi: cố ý nhét dấu nháy đơn và tiếng Việt có dấu — đúng hai thứ hay làm
  // vỡ một đường ống chắp bằng chuỗi SQL.
  return `drill-${name}-${i}-O'Brien-Đặng`;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    shell: false,
    ...opts,
  });
  return {
    code: r.status,
    out: `${r.stdout ?? ""}${r.stderr ?? ""}`,
    error: r.error,
  };
}

async function applyMigrations(client) {
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8"),
  );
  const files = journal.entries
    ? journal.entries.map((e) => `${e.tag}.sql`)
    : readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith(".sql"))
        .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    for (const stmt of sql
      .split(/--> statement-breakpoint/)
      .map((s) => s.trim())
      .filter(Boolean)) {
      await client.execute(stmt);
    }
  }
}

async function userTables(client) {
  const r = await client.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' AND name NOT IN ('replica_state', 'replica_sync') ORDER BY name`,
  );
  return r.rows.map((x) => String(x.name));
}

/** Đổ dữ liệu bịa vào mọi bảng; trả về danh sách bảng đã có dòng. */
async function seed(client, tables, rowsPerTable) {
  const filled = [];
  const skipped = [];
  for (const t of tables) {
    const fkList = await client.execute(`PRAGMA foreign_key_list("${t}")`);
    const fkCols = new Set(fkList.rows.map((r) => String(r.from)));
    const info = await client.execute(`PRAGMA table_info("${t}")`);
    const cols = info.rows.map((r) => ({
      name: String(r.name),
      type: String(r.type),
      notNull: Number(r.notnull) === 1,
      pk: Number(r.pk) === 1,
    }));
    if (cols.length === 0) continue;
    let inserted = 0;
    for (let i = 1; i <= rowsPerTable; i++) {
      const names = [];
      const values = [];
      for (const c of cols) {
        // Dòng thứ 2 để trống mọi cột cho phép NULL — bản dump phải giữ được
        // NULL, không biến nó thành chuỗi rỗng hay số 0.
        if (i === 2 && !c.notNull && !c.pk) continue;
        names.push(`"${c.name}"`);
        values.push(fakeValue(c, i, fkCols.has(c.name)));
      }
      try {
        await client.execute({
          sql: `INSERT INTO "${t}" (${names.join(", ")}) VALUES (${names
            .map(() => "?")
            .join(", ")})`,
          args: values,
        });
        inserted++;
      } catch {
        // CHECK/UNIQUE/FK của một bảng cụ thể có thể từ chối dữ liệu bịa.
        // Ghi nhận rồi đi tiếp: mục tiêu là phủ được càng nhiều bảng càng tốt,
        // không phải ép mọi bảng.
      }
    }
    if (inserted > 0) filled.push(t);
    else skipped.push(t);
  }
  return { filled, skipped };
}

async function dumpAll(client, tables) {
  const out = {};
  for (const t of tables) {
    const r = await client.execute(`SELECT * FROM "${t}"`);
    out[t] = r.rows.map((row) => ({ ...row }));
  }
  return out;
}

async function main() {
  const KEEP = process.argv.includes("--keep");
  const dir = mkdtempSync(join(tmpdir(), "fwbb-drill-"));
  const sourcePath = join(dir, "source.db");
  const targetPath = join(dir, "target.db");
  const dumpPath = join(dir, "dump.json");
  const encPath = join(dir, "backup.json.enc");
  const backPath = join(dir, "dump-back.json");
  // Mật khẩu CHỈ sống trong lần chạy này. Không phải BACKUP_PASSPHRASE thật,
  // và không bao giờ được in ra.
  const passphrase = randomBytes(24).toString("base64");

  let failures = [];
  let source;
  let target;

  try {
    console.log(`\n🔁 DIỄN TẬP SAO LƯU — KHÔI PHỤC`);
    console.log(`Thư mục tạm: ${dir}\n`);

    // ── 1. Database nguồn, dữ liệu bịa ───────────────────────────────────
    source = createClient({ url: fileUrl(sourcePath) });
    await applyMigrations(source);
    // Tắt khoá ngoại CHỈ lúc đổ dữ liệu bịa: thứ tự bảng là theo bảng chữ
    // cái, nên bảng con hay được đổ trước bảng cha. Bước khôi phục ở dưới
    // vẫn chạy với khoá ngoại BẬT, đó mới là chỗ đáng kiểm.
    await source.execute("PRAGMA foreign_keys = OFF");
    const tables = await userTables(source);
    const { filled, skipped } = await seed(source, tables, 3);
    console.log(
      `1. Nguồn: ${tables.length} bảng, đổ dữ liệu được ${filled.length}.`,
    );
    if (skipped.length)
      console.log(`   Bỏ qua (ràng buộc chặn): ${skipped.join(", ")}`);

    const missing = MUST_COVER.filter((t) => !filled.includes(t));
    if (missing.length) {
      failures.push(
        `Không đổ được dữ liệu vào bảng quan trọng: ${missing.join(", ")}. ` +
          `Bài diễn tập không nói lên điều gì khi thiếu mấy bảng này.`,
      );
    }
    const before = await dumpAll(source, filled);
    source.close();
    source = null;

    // ── 2. Dump qua ĐÚNG script mà lịch sao lưu dùng ──────────────────────
    const dump = run(process.execPath, ["scripts/backup-db.mjs", dumpPath], {
      env: {
        ...process.env,
        TURSO_DATABASE_URL: fileUrl(sourcePath),
        TURSO_AUTH_TOKEN: "",
      },
    });
    if (dump.code !== 0) {
      failures.push(`backup-db.mjs thoát ${dump.code}:\n${dump.out}`);
      throw new Error("dump hỏng");
    }
    console.log(`2. Dump xong: ${dumpPath}`);

    // ── 3. Mã hoá + giải mã bằng ĐÚNG tham số của workflow ────────────────
    const encArgs = [
      "enc",
      "-aes-256-cbc",
      "-pbkdf2",
      "-iter",
      "300000",
      "-salt",
      "-in",
      dumpPath,
      "-out",
      encPath,
      "-pass",
      "env:DRILL_PASS",
    ];
    const enc = run("openssl", encArgs, {
      env: { ...process.env, DRILL_PASS: passphrase },
    });
    if (enc.error || enc.code !== 0) {
      failures.push(
        `openssl enc thoát ${enc.code}: ${enc.error?.message ?? ""}\n${enc.out}`,
      );
      throw new Error("mã hoá hỏng");
    }
    // Xoá bản đọc được NGAY, đúng như workflow làm. Từ đây trở đi chỉ còn bản
    // mã hoá, nên bước sau thật sự phải giải mã mới có dữ liệu.
    rmSync(dumpPath, { force: true });

    const dec = run(
      "openssl",
      [
        "enc",
        "-d",
        "-aes-256-cbc",
        "-pbkdf2",
        "-iter",
        "300000",
        "-in",
        encPath,
        "-out",
        backPath,
        "-pass",
        "env:DRILL_PASS",
      ],
      { env: { ...process.env, DRILL_PASS: passphrase } },
    );
    if (dec.code !== 0) {
      failures.push(`openssl giải mã thoát ${dec.code}:\n${dec.out}`);
      throw new Error("giải mã hỏng");
    }
    console.log(`3. Mã hoá rồi giải mã lại: khớp cặp tham số openssl.`);

    // ── 4. Khôi phục sang database tạm thứ hai ────────────────────────────
    target = createClient({ url: fileUrl(targetPath) });
    await applyMigrations(target);
    target.close();
    target = null;

    const res = run(
      process.execPath,
      [
        "scripts/restore-db.mjs",
        backPath,
        `--target=${fileUrl(targetPath)}`,
        "--apply",
      ],
      { env: process.env },
    );
    if (res.code !== 0) {
      failures.push(`restore-db.mjs thoát ${res.code}:\n${res.out}`);
      throw new Error("khôi phục hỏng");
    }
    console.log(`4. Khôi phục xong.`);

    // ── 5. So từng bảng ───────────────────────────────────────────────────
    target = createClient({ url: fileUrl(targetPath) });
    const after = await dumpAll(target, filled);
    target.close();
    target = null;

    for (const t of filled) {
      failures.push(...diffTables(t, before[t], after[t]));
    }
    const rowCount = filled.reduce((n, t) => n + before[t].length, 0);
    console.log(`5. So sánh: ${filled.length} bảng, ${rowCount} dòng.`);
  } catch (err) {
    if (failures.length === 0) {
      console.error(`\n💥 ${err?.stack ?? err}\n`);
      cleanup();
      process.exit(2);
    }
  } finally {
    try {
      source?.close();
      target?.close();
    } catch {
      /* đã đóng */
    }
  }

  function cleanup() {
    if (KEEP) {
      console.log(`\n(giữ lại ${dir} theo --keep)`);
      return;
    }
    // Dump và bản giải mã chứa dữ liệu bịa, nhưng vẫn dọn: thư mục tạm đầy
    // file .db bỏ lại là thói quen xấu khi script thật chạy với dữ liệu thật.
    for (const f of [dumpPath, backPath, encPath]) {
      if (existsSync(f)) rmSync(f, { force: true });
    }
    try {
      // Tren Windows, file .db vua dong con bi giu them mot nhip. Thu lai vai
      // lan truoc khi chiu thua.
      for (let attempt = 1; ; attempt++) {
        try {
          rmSync(dir, { recursive: true, force: true });
          break;
        } catch (err) {
          if (attempt >= 5) throw err;
          const until = Date.now() + 200;
          while (Date.now() < until) {
            /* cho handle nha ra */
          }
        }
      }
    } catch (err) {
      // Trên Windows, file .db vừa đóng có thể còn bị giữ thêm một nhịp. Dọn
      // không xong thì nói ra rồi đi tiếp, chứ đừng làm hỏng kết quả diễn tập
      // vì một cái file tạm.
      console.warn(`(khong xoa duoc ${dir}: ${err.code ?? err.message})`);
    }
  }

  cleanup();

  if (failures.length > 0) {
    console.error(`\n❌ ${failures.length} vấn đề:\n`);
    for (const f of failures) console.error(`  • ${f}`);
    console.error("");
    process.exit(1);
  }
  console.log(
    `\n✅ Dump → mã hoá → giải mã → khôi phục ra đúng dữ liệu ban đầu.\n`,
  );
}

// Chỉ chạy khi gọi trực tiếp; file này còn được import để kiểm mấy hàm thuần.
if (process.argv[1] && process.argv[1].endsWith("backup-drill.mjs")) {
  await main();
}

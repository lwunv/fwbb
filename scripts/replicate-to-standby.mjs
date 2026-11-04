/**
 * Copy toàn bộ database chính sang database dự phòng.
 *
 * Dùng lại hai script đã có thay vì viết lại: `backup-db.mjs` chụp, rồi
 * `restore-db.mjs` nạp. Nạp là XOÁ SẠCH RỒI GHI LẠI, nên bản dự phòng luôn
 * giống hệt bản chính tại thời điểm chụp.
 *
 * ━━━ CHỐT CHẶN QUAN TRỌNG NHẤT ━━━
 * Nếu app ĐANG chạy trên bản dự phòng (sự cố đang diễn ra), script này KHÔNG
 * ĐƯỢC chạy. Lúc đó dữ liệu mới nằm ở bản dự phòng còn bản chính thì cũ; copy
 * đè lên là xoá sạch mọi thứ mọi người vừa nhập trong lúc sự cố. Nó đọc cờ
 * `replica_state` trên chính bản dự phòng và tự bỏ qua.
 *
 * Chạy:
 *   node scripts/replicate-to-standby.mjs            → chạy thử
 *   node scripts/replicate-to-standby.mjs --apply    → copy thật
 *   ... --dump=<file.json>                           → dùng lại bản chụp có
 *       sẵn thay vì chụp mới. Workflow sao lưu đã chụp một lần rồi, chụp lại
 *       là tốn thêm một lượt đọc trên bản chính mà chẳng được gì.
 *
 * Biến môi trường:
 *   TURSO_DATABASE_URL / TURSO_AUTH_TOKEN      nguồn (bản chính)
 *   STANDBY_DATABASE_URL / STANDBY_AUTH_TOKEN  đích (bản dự phòng)
 */

import { createClient } from "@libsql/client";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Có được phép ghi đè lên bản dự phòng không?
 *
 * Tách riêng để kiểm được bằng test, vì đây là chỗ sai thì mất dữ liệu thật.
 * Đọc cờ hỏng (bảng chưa có, mạng lỗi) thì `row` là null, và lúc đó CHO phép
 * copy: bản dự phòng chưa từng được kích hoạt bao giờ.
 */
export function mayOverwriteStandby(row) {
  return row?.active !== "standby";
}

/**
 * Dựng câu định nghĩa một cột để ghép vào `ALTER TABLE ... ADD COLUMN`.
 * Lấy từ PRAGMA table_info của bản chính, nên `dflt_value` đã ở dạng SQL sẵn
 * (vd `'group'` cho text, `0` cho số) và dùng nguyên.
 */
function columnDdl(col) {
  let s = `"${col.name}" ${col.type ?? ""}`.trimEnd();
  if (col.dflt_value !== null && col.dflt_value !== undefined) {
    s += ` DEFAULT ${col.dflt_value}`;
  }
  if (col.notnull) s += " NOT NULL";
  return s;
}

/**
 * So schema bản chính với bản dự phòng và sinh các lệnh DDL để bản dự phòng
 * kịp bản chính. VÁ GỐC cho sự cố 04/11/2026: bản dump chỉ có dữ liệu, không
 * có cấu trúc, nên khi bản chính thêm cột (migration 0027 thêm `signup_intent`)
 * thì INSERT của restore-db vỡ vì cột chưa tồn tại ở dự phòng.
 *
 * CHỈ làm thao tác CỘNG THÊM (thêm bảng, thêm cột) vì chỉ thao tác cộng thêm
 * mới an toàn tự động. Thay đổi phá vỡ (cột/bảng bị xoá ở bản chính, hay cột
 * mới NOT NULL mà không có mặc định) thì KHÔNG tự làm, chỉ đưa vào `warnings`
 * để người xem, và để restore báo đỏ nếu thật sự không nạp được.
 *
 * Thuần, không chạm DB, để test được. `prod`/`standby` là shape do
 * `introspectSchema` dựng: `{ tables: { <tên>: { columns, createSql?, indexes? } } }`.
 */
export function planSchemaSync(prod, standby) {
  const statements = [];
  const warnings = [];
  const prodTables = prod?.tables ?? {};
  const standbyTables = standby?.tables ?? {};

  for (const [name, pt] of Object.entries(prodTables)) {
    const st = standbyTables[name];
    if (!st) {
      // Bảng mới hoàn toàn: tạo y hệt bản chính rồi dựng lại index của nó.
      if (pt.createSql) {
        statements.push(pt.createSql);
        for (const idx of pt.indexes ?? []) {
          if (idx.sql) statements.push(idx.sql);
        }
      } else {
        warnings.push(
          `Bảng "${name}" thiếu ở dự phòng nhưng không có DDL nguồn để tạo.`,
        );
      }
      continue;
    }
    const have = new Set((st.columns ?? []).map((c) => c.name));
    for (const col of pt.columns ?? []) {
      if (have.has(col.name)) continue;
      const noDefault =
        col.dflt_value === null || col.dflt_value === undefined;
      if (col.notnull && noDefault) {
        // SQLite từ chối ADD COLUMN NOT NULL không mặc định khi bảng còn dòng,
        // mà lúc chạy ALTER thì dữ liệu cũ vẫn còn (restore xoá sau). Bỏ qua,
        // để restore báo đỏ rõ ràng thay vì sinh ra một lệnh chắc chắn hỏng.
        warnings.push(
          `Cột "${name}.${col.name}" NOT NULL không có mặc định: không thể thêm ` +
            `an toàn, bỏ qua (restore sẽ báo đỏ nếu bản chính thật sự cần nó).`,
        );
        continue;
      }
      statements.push(`ALTER TABLE "${name}" ADD COLUMN ${columnDdl(col)}`);
    }
  }

  // Chiều ngược lại chỉ để cảnh báo, KHÔNG bao giờ tự xoá: xoá là thao tác phá
  // vỡ, phải có người xem. Cột/bảng thừa ở dự phòng cũng không cản việc nạp
  // (restore chỉ ghi các cột mà bản chính có).
  for (const [name, st] of Object.entries(standbyTables)) {
    const pt = prodTables[name];
    if (!pt) {
      warnings.push(
        `Bảng "${name}" có ở dự phòng nhưng không có ở bản chính (không tự xoá).`,
      );
      continue;
    }
    const prodCols = new Set((pt.columns ?? []).map((c) => c.name));
    for (const col of st.columns ?? []) {
      if (!prodCols.has(col.name)) {
        warnings.push(
          `Cột "${name}.${col.name}" có ở dự phòng nhưng không có ở bản chính (không tự xoá).`,
        );
      }
    }
  }

  return { statements, warnings };
}

// Các bảng điều khiển/nội bộ không thuộc schema dữ liệu của app. Giữ khớp với
// danh sách loại trừ trong backup-db.mjs để hai bên nói về cùng một tập bảng.
const SCHEMA_SKIP = `name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream%' AND name NOT LIKE '__drizzle%' AND name NOT IN ('replica_state', 'replica_sync')`;

/**
 * Đọc cấu trúc (không đọc dữ liệu) của một database libsql thành shape mà
 * `planSchemaSync` hiểu. Chỉ chạm metadata: rẻ hơn nhiều so với dump dữ liệu.
 */
export async function introspectSchema(client) {
  const tablesRes = await client.execute(
    `SELECT name, sql FROM sqlite_master WHERE type='table' AND ${SCHEMA_SKIP} ORDER BY name`,
  );
  const tables = {};
  for (const r of tablesRes.rows) {
    const name = String(r.name);
    const info = await client.execute(`PRAGMA table_info("${name}")`);
    const columns = info.rows.map((c) => ({
      name: String(c.name),
      type: c.type == null ? "" : String(c.type),
      notnull: Number(c.notnull) === 1,
      dflt_value: c.dflt_value == null ? null : String(c.dflt_value),
    }));
    const idxRes = await client.execute({
      sql: `SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name = ? AND sql IS NOT NULL`,
      args: [name],
    });
    const indexes = idxRes.rows.map((i) => ({
      name: String(i.name),
      sql: String(i.sql),
    }));
    tables[name] = { columns, createSql: r.sql == null ? null : String(r.sql), indexes };
  }
  return { tables };
}

/**
 * Bắt bản dự phòng kịp cấu trúc bản chính TRƯỚC khi nạp dữ liệu. Chạy các lệnh
 * cộng thêm do `planSchemaSync` sinh ra. Trả về số lệnh đã chạy để bên gọi báo.
 */
export async function syncStandbySchema(primary, standby) {
  const [prodSchema, standbySchema] = await Promise.all([
    introspectSchema(primary),
    introspectSchema(standby),
  ]);
  const { statements, warnings } = planSchemaSync(prodSchema, standbySchema);

  for (const w of warnings) console.log(`   ⚠️  ${w}`);

  if (statements.length === 0) {
    console.log("   Cấu trúc đã khớp, không cần đổi gì.");
    return 0;
  }

  for (const sql of statements) {
    console.log(`   + ${sql}`);
    await standby.execute(sql);
  }
  return statements.length;
}

const APPLY = process.argv.includes("--apply");
const dumpArg = process.argv.find((a) => a.startsWith("--dump="));

function die(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

async function main() {
  const standbyUrl = process.env.STANDBY_DATABASE_URL;
  if (!standbyUrl) die("Thiếu STANDBY_DATABASE_URL.");
  if (!process.env.TURSO_DATABASE_URL) die("Thiếu TURSO_DATABASE_URL.");

  const standby = createClient({
    url: standbyUrl,
    authToken: process.env.STANDBY_AUTH_TOKEN,
  });

  let row = null;
  try {
    const r = await standby.execute(
      "SELECT active, since FROM replica_state WHERE id = 1",
    );
    row = r.rows[0] ?? null;
  } catch {
    // Bảng chưa tồn tại = chưa từng chuyển lần nào. Đúng đường chạy bình
    // thường, không phải lỗi.
  }

  if (!mayOverwriteStandby(row)) {
    console.log(
      `\n⏸  BỎ QUA: app đang chạy trên bản dự phòng (từ ${row.since}).\n` +
        `   Copy lúc này sẽ xoá mất phần mọi người vừa nhập trong lúc sự cố.\n` +
        `   Khi bản chính sống lại, đồng bộ NGƯỢC bằng scripts/failover.mjs.\n`,
    );
    return;
  }

  if (!APPLY) {
    console.log(
      `\n🔍 Chạy thử. Sẽ copy toàn bộ bản chính sang ${standbyUrl}.\n` +
        `   Thêm --apply để làm thật.\n`,
    );
    return;
  }

  // Bản dump là dữ liệu cá nhân dạng đọc được: để trong thư mục tạm riêng và
  // xoá ở `finally`, kể cả khi nạp hỏng giữa chừng.
  const reused = dumpArg?.slice("--dump=".length);
  const dir = reused ? null : mkdtempSync(join(tmpdir(), "fwbb-replicate-"));
  const dumpPath = reused ?? join(dir, "dump.json");
  try {
    // Bắt bản dự phòng kịp cấu trúc bản chính TRƯỚC khi nạp. Bản dump chỉ có
    // dữ liệu; nếu bản chính vừa thêm cột (migration mới) mà bản dự phòng chưa
    // có thì INSERT của restore vỡ. Chỉ cộng thêm bảng/cột, không xoá gì.
    console.log("\n🔧 Đồng bộ cấu trúc bản dự phòng theo bản chính...");
    const primary = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    try {
      await syncStandbySchema(primary, standby);
    } catch (e) {
      die(`Đồng bộ cấu trúc thất bại: ${e.message}`);
    } finally {
      primary.close();
    }

    if (!reused) {
      const dump = spawnSync(
        process.execPath,
        ["scripts/backup-db.mjs", dumpPath],
        { stdio: "inherit" },
      );
      if (dump.status !== 0) die("Chụp bản chính thất bại.");
    }

    const load = spawnSync(
      process.execPath,
      [
        "scripts/restore-db.mjs",
        dumpPath,
        `--target=${standbyUrl}`,
        "--apply",
        "--remote-i-am-sure",
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          RESTORE_TARGET_TOKEN: process.env.STANDBY_AUTH_TOKEN ?? "",
        },
      },
    );
    if (load.status !== 0) die("Nạp vào bản dự phòng thất bại.");

    // Ghi mốc thời gian NGAY SAU khi nạp xong. Đây là thứ duy nhất cho biết
    // bản dự phòng còn tươi hay đã mục: `scripts/check-standby.mjs` đọc đúng
    // dòng này và báo đỏ khi nó quá cũ. Ghi trước khi nạp thì mốc sẽ nói dối
    // mỗi lần nạp hỏng giữa chừng.
    await standby.batch(
      [
        `CREATE TABLE IF NOT EXISTS replica_sync (
           id INTEGER PRIMARY KEY CHECK (id = 1),
           synced_at TEXT NOT NULL
         )`,
        {
          sql: `INSERT INTO replica_sync (id, synced_at) VALUES (1, ?)
                ON CONFLICT(id) DO UPDATE SET synced_at = excluded.synced_at`,
          args: [new Date().toISOString()],
        },
      ],
      "write",
    );
    console.log("\n✅ Bản dự phòng đã khớp với bản chính.\n");
  } finally {
    // Chỉ xoá thư mục do chính script này tạo. Bản chụp mượn của workflow thì
    // workflow tự lo, xoá hộ là nó mất file trước khi kịp mã hoá.
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

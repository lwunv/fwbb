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

/**
 * Điều khiển việc chuyển giữa database chính và database dự phòng.
 *
 * App tự chuyển SANG bản dự phòng khi bản chính chết (xem src/db/failover.ts).
 * Nhưng chiều ngược lại thì KHÔNG BAO GIỜ tự động, vì lúc đó dữ liệu mới nằm ở
 * bản dự phòng: quay về mà chưa đồng bộ ngược là vứt sạch mọi thứ cả nhóm đã
 * nhập trong lúc sự cố. Script này là cái cần gạt tay cho chiều đó.
 *
 *   node scripts/failover.mjs --status
 *       Đang chạy ở đâu, từ lúc nào.
 *
 *   node scripts/failover.mjs --to-standby --apply
 *       Chuyển sang bản dự phòng ngay, không cần đợi bản chính chết. Dùng khi
 *       biết trước sắp có sự cố, hoặc để diễn tập.
 *
 *   node scripts/failover.mjs --recover --apply
 *       Bản chính sống lại rồi: copy NGƯỢC từ bản dự phòng về bản chính, rồi
 *       mới hạ cờ. Đúng thứ tự này, không được đổi.
 *
 * Biến môi trường: TURSO_DATABASE_URL/TOKEN (chính), STANDBY_DATABASE_URL/TOKEN.
 */

import { createClient } from "@libsql/client";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const STATE_TABLE = "replica_state";

function die(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

function standbyClient() {
  const url = process.env.STANDBY_DATABASE_URL;
  if (!url) die("Thiếu STANDBY_DATABASE_URL.");
  return createClient({ url, authToken: process.env.STANDBY_AUTH_TOKEN });
}

async function readState(client) {
  try {
    const r = await client.execute(
      `SELECT active, since, reason FROM ${STATE_TABLE} WHERE id = 1`,
    );
    return r.rows[0] ?? null;
  } catch {
    return null;
  }
}

async function writeState(client, active, reason) {
  await client.batch(
    [
      `CREATE TABLE IF NOT EXISTS ${STATE_TABLE} (
         id INTEGER PRIMARY KEY CHECK (id = 1),
         active TEXT NOT NULL, since TEXT NOT NULL, reason TEXT
       )`,
      {
        sql: `INSERT INTO ${STATE_TABLE} (id, active, since, reason)
              VALUES (1, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                active = excluded.active, since = excluded.since,
                reason = excluded.reason`,
        args: [active, new Date().toISOString(), reason],
      },
    ],
    "write",
  );
}

/** Chụp `fromUrl` rồi nạp đè vào `toUrl`. Dùng lại hai script đã có. */
function copyDatabase({ fromUrl, fromToken, toUrl, toToken }) {
  const dir = mkdtempSync(join(tmpdir(), "fwbb-failover-"));
  const dumpPath = join(dir, "dump.json");
  try {
    const dump = spawnSync(
      process.execPath,
      ["scripts/backup-db.mjs", dumpPath],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          TURSO_DATABASE_URL: fromUrl,
          TURSO_AUTH_TOKEN: fromToken ?? "",
        },
      },
    );
    if (dump.status !== 0) die("Chụp nguồn thất bại.");

    const load = spawnSync(
      process.execPath,
      [
        "scripts/restore-db.mjs",
        dumpPath,
        `--target=${toUrl}`,
        "--apply",
        "--remote-i-am-sure",
      ],
      {
        stdio: "inherit",
        env: { ...process.env, RESTORE_TARGET_TOKEN: toToken ?? "" },
      },
    );
    if (load.status !== 0) die("Nạp vào đích thất bại.");
  } finally {
    // Bản dump là dữ liệu cá nhân dạng đọc được, xoá kể cả khi hỏng giữa chừng.
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const APPLY = args.includes("--apply");
  const client = standbyClient();

  if (args.includes("--status")) {
    const s = await readState(client);
    console.log(
      s
        ? `\nĐang chạy trên: ${s.active}\nTừ lúc: ${s.since}\nLý do: ${s.reason ?? "không rõ"}\n`
        : "\nChưa từng chuyển lần nào. App đang dùng bản chính.\n",
    );
    return;
  }

  if (args.includes("--to-standby")) {
    if (!APPLY) {
      console.log("\n🔍 Chạy thử. Thêm --apply để chuyển thật.\n");
      return;
    }
    await writeState(client, "standby", "chuyen bang tay");
    console.log(
      "\n✅ Đã bật cờ. Các instance sẽ chuyển trong vòng 30 giây.\n" +
        "   Từ giờ MỌI thao tác ghi nằm ở bản dự phòng.\n",
    );
    return;
  }

  if (args.includes("--recover")) {
    const s = await readState(client);
    if (s?.active !== "standby") {
      die("Cờ không ở trạng thái 'standby'. Không có gì để khôi phục.");
    }
    const primaryUrl = process.env.TURSO_DATABASE_URL;
    if (!primaryUrl) die("Thiếu TURSO_DATABASE_URL (đích để copy ngược về).");

    if (!APPLY) {
      console.log(
        `\n🔍 Chạy thử. Sẽ copy NGƯỢC từ bản dự phòng về ${primaryUrl},\n` +
          `   XOÁ SẠCH nội dung hiện có của bản chính, rồi mới hạ cờ.\n` +
          `   Thêm --apply để làm thật.\n`,
      );
      return;
    }

    console.log("\n♻️  Bước 1/2: copy ngược dữ liệu về bản chính...\n");
    copyDatabase({
      fromUrl: process.env.STANDBY_DATABASE_URL,
      fromToken: process.env.STANDBY_AUTH_TOKEN,
      toUrl: primaryUrl,
      toToken: process.env.TURSO_AUTH_TOKEN,
    });

    // Hạ cờ SAU khi dữ liệu đã về. Hạ trước là đẩy mọi người sang một bản
    // chính còn cũ.
    console.log("\n🚩 Bước 2/2: hạ cờ...\n");
    await writeState(client, "primary", "khoi phuc bang tay");
    console.log(
      "\n✅ Xong. Các instance quay về bản chính trong vòng 30 giây.\n",
    );
    return;
  }

  console.log("\nDùng: --status | --to-standby --apply | --recover --apply\n");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

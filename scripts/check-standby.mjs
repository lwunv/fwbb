/**
 * Canh sức khoẻ của database dự phòng.
 *
 * Vì sao cần: một bản dự phòng không ai đụng tới sẽ mục dần mà không phát ra
 * tiếng động nào. Nó chỉ lộ ra là hỏng đúng lúc bản chính chết, tức đúng lúc
 * không còn đường lùi. Việc chạy theo lịch này tồn tại để biến một sự cố im
 * lặng thành một cái mail đỏ.
 *
 * Kiểm sáu thứ:
 *   1. Cấu hình có an toàn không (đường kết nối mã hoá, có token).
 *   2. Có nối tới được không.
 *   3. Có đủ cấu trúc bảng không (đã chạy migration chưa).
 *   4. Có dữ liệu thật không, hay là một database rỗng.
 *   5. Bản sao mới tới đâu (quá cũ = nhân bản đã hỏng từ lâu).
 *   6. App có đang chạy TRÊN bản dự phòng không (tức là đang có sự cố).
 *
 * Chạy: node scripts/check-standby.mjs
 * Thoát: 0 = ổn, 1 = có vấn đề, 2 = chính script hỏng.
 */

import { createClient } from "@libsql/client";
import { pathToFileURL } from "node:url";

/** Quá hạn này mà chưa nhân bản lần nào thì coi là hỏng. */
const MAX_AGE_HOURS = Number(process.env.STANDBY_MAX_AGE_HOURS ?? 12);

/**
 * Bản sao của luật trong `src/db/failover.ts` (`validateStandbyConfig`).
 *
 * Nguồn sự thật là file TS đó, vì app chạy theo nó. Chép lại ở đây vì script
 * .mjs này không nạp được file TS, và nếu bỏ hẳn bước kiểm thì một đường
 * `http://` sẽ nối được bình thường, không báo gì, trong khi dữ liệu và token
 * đi trần trên mạng. Sửa một nơi thì sửa cả hai.
 */
function checkConfig(url, token) {
  if (!url) return "STANDBY_DATABASE_URL trống";
  const scheme = url.slice(0, url.indexOf(":") + 1).toLowerCase();
  if (scheme === "file:") return null;
  if (scheme === "http:" || scheme === "ws:") {
    return `dùng ${scheme} (không mã hoá): dữ liệu và token sẽ đi trần trên mạng`;
  }
  if (!["libsql:", "https:", "wss:"].includes(scheme)) {
    return `scheme lạ: ${scheme}`;
  }
  if (!token) return "STANDBY_AUTH_TOKEN trống (ai cũng đọc ghi được)";
  return null;
}

/**
 * Từ các số đo thô ra kết luận. Tách riêng để kiểm được bằng test mà không
 * cần một database thật.
 */
export function evaluate({
  configError,
  reachable,
  missingTables,
  memberRows,
  syncedAt,
  active,
  now = Date.now(),
  maxAgeHours = MAX_AGE_HOURS,
}) {
  const problems = [];
  const notes = [];

  if (configError) problems.push(`Cấu hình không an toàn: ${configError}`);
  if (!reachable) {
    problems.push("Không nối tới được bản dự phòng.");
    // Không nối được thì mọi số đo bên dưới vô nghĩa, đừng báo thêm cho rối.
    return { problems, notes };
  }

  if (missingTables?.length) {
    problems.push(
      `Thiếu ${missingTables.length} bảng (chưa chạy migration?): ${missingTables.slice(0, 5).join(", ")}`,
    );
  }
  if (typeof memberRows === "number" && memberRows <= 0) {
    problems.push("Bảng members rỗng: bản dự phòng không có dữ liệu để cứu.");
  }

  if (!syncedAt) {
    problems.push("Chưa từng nhân bản lần nào.");
  } else {
    const ageMs = now - Date.parse(syncedAt);
    if (Number.isNaN(ageMs)) {
      problems.push(`Mốc thời gian nhân bản không đọc được: ${syncedAt}`);
    } else {
      const ageHours = ageMs / 3_600_000;
      if (ageHours > maxAgeHours) {
        problems.push(
          `Bản sao cũ ${ageHours.toFixed(1)} giờ (ngưỡng ${maxAgeHours} giờ). Việc nhân bản có thể đã hỏng.`,
        );
      } else {
        notes.push(`Bản sao mới cách đây ${ageHours.toFixed(1)} giờ.`);
      }
    }
  }

  // Đây KHÔNG phải lỗi của bản dự phòng, nhưng là thứ phải hiện lên ngay:
  // app đang chạy trên dự phòng nghĩa là bản chính đang chết.
  if (active === "standby") {
    problems.push(
      "APP ĐANG CHẠY TRÊN BẢN DỰ PHÒNG. Bản chính đang hỏng, và việc nhân bản đã tự dừng để khỏi ghi đè.",
    );
  }

  return { problems, notes };
}

/** Những bảng bắt buộc phải có thì bản dự phòng mới thay thế được. */
const REQUIRED_TABLES = [
  "members",
  "sessions",
  "votes",
  "session_debts",
  "session_attendees",
  "financial_transactions",
  "app_settings",
];

async function main() {
  const url = process.env.STANDBY_DATABASE_URL;
  const token = process.env.STANDBY_AUTH_TOKEN;
  const configError = checkConfig(url, token);

  if (!url) {
    console.log(
      "Chưa khai STANDBY_DATABASE_URL — chưa dựng bản dự phòng. Bỏ qua.",
    );
    process.exit(0);
  }

  let reachable = false;
  let missingTables = [];
  let memberRows;
  let syncedAt = null;
  let active = null;

  if (!configError) {
    const c = createClient({ url, authToken: token });
    try {
      const names = await c.execute(
        "SELECT name FROM sqlite_master WHERE type='table'",
      );
      reachable = true;
      const have = new Set(names.rows.map((r) => String(r.name)));
      missingTables = REQUIRED_TABLES.filter((t) => !have.has(t));

      if (have.has("members")) {
        const r = await c.execute("SELECT COUNT(*) AS n FROM members");
        memberRows = Number(r.rows[0].n);
      }
      if (have.has("replica_sync")) {
        const r = await c.execute(
          "SELECT synced_at FROM replica_sync WHERE id = 1",
        );
        syncedAt = r.rows[0]?.synced_at ? String(r.rows[0].synced_at) : null;
      }
      if (have.has("replica_state")) {
        const r = await c.execute(
          "SELECT active FROM replica_state WHERE id = 1",
        );
        active = r.rows[0]?.active ? String(r.rows[0].active) : null;
      }
    } catch (err) {
      // Chỉ lấy phần ngắn của thông báo: thông báo lỗi DB có thể kèm mảnh câu
      // truy vấn, mà câu truy vấn thì chứa dữ liệu cá nhân.
      console.error(
        `Lỗi khi đọc bản dự phòng: ${String(err?.code ?? err?.name ?? "UNKNOWN")}`,
      );
    } finally {
      c.close();
    }
  }

  const { problems, notes } = evaluate({
    configError,
    reachable,
    missingTables,
    memberRows,
    syncedAt,
    active,
  });

  console.log("=== Sức khoẻ database dự phòng ===");
  for (const n of notes) console.log(`  ${n}`);
  if (typeof memberRows === "number") {
    console.log(`  Số thành viên trong bản dự phòng: ${memberRows}`);
  }

  if (problems.length === 0) {
    console.log("\n✅ Bản dự phòng sẵn sàng.");
    process.exit(0);
  }
  for (const p of problems) console.error(`::error::${p}`);
  console.error(`\n❌ ${problems.length} vấn đề.`);
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`Script hỏng: ${String(err?.message ?? err)}`);
    process.exit(2);
  });
}

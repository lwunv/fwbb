import { test, expect } from "@playwright/test";
import { createClient } from "@libsql/client";

async function db() {
  const c = createClient({ url: "file:e2e/local.db" });
  // Fixture và server Next mở CÙNG file e2e/local.db, nên ghi đồng thời làm
  // SQLITE_BUSY. Chờ lock nhả thay vì chết ngay. Cùng cách src/db/test-db.ts
  // đã dùng cho test tích hợp.
  await c.execute("PRAGMA busy_timeout = 5000");
  return c;
}

// Lớp e2e cho phần "đổi setting → UI thật đổi" (không chỉ compile/wire).
// Chuỗi được chứng minh: giá trị trong app_settings → getSettings() ở root
// layout → SettingsProvider → useSettings() trong AdminSessionCard →
// MaxPlayersToggle render đúng các mức mới. maxPlayersOptions chọn vì render
// thẳng các con số, assert không mơ hồ.
test("maxPlayersOptions: đổi setting → nút sức chứa trên card buổi đổi theo", async ({
  page,
}) => {
  const c = await db();
  // Lấy buổi mới nhất để tạm chuyển sang voting; nhớ trạng thái cũ để hoàn nguyên.
  const s = await c.execute(
    "SELECT id, status, max_players FROM sessions ORDER BY date DESC LIMIT 1",
  );
  const row = s.rows[0];
  const sessionId = Number(row.id);
  const origStatus = String(row.status);
  const origMax = Number(row.max_players);

  // Options tuỳ biến (khác default [8,12,16,20]) + buổi voting, maxPlayers nằm
  // trong list để toggle không tự chèn thêm số hiện tại.
  await c.execute(
    "INSERT INTO app_settings (key, value) VALUES ('maxPlayersOptions', '[6,10,14]') ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  await c.execute({
    sql: "UPDATE sessions SET status='voting', max_players=6 WHERE id = ?",
    args: [sessionId],
  });
  c.close();

  try {
    await page.goto(`/admin/sessions/${sessionId}`, {
      waitUntil: "domcontentloaded",
    });
    // Các mức tuỳ biến phải hiện — chỉ có thể đến từ setting, không phải default.
    await expect(
      page.getByRole("button", { name: "6", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "10", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "14", exact: true }),
    ).toBeVisible();
  } finally {
    const c2 = await db();
    await c2.execute({
      sql: "UPDATE sessions SET status=?, max_players=? WHERE id = ?",
      args: [origStatus, origMax, sessionId],
    });
    await c2.execute("DELETE FROM app_settings WHERE key='maxPlayersOptions'");
    c2.close();
  }
});

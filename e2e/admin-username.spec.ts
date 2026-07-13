import { test, expect } from "@playwright/test";
import { createClient } from "@libsql/client";

/**
 * E2E: admin đặt username khi TẠO member (form "Thêm thành viên"). Chứng minh
 * cả stack UI → server action → DB: username lưu chuẩn hoá lowercase. (Logic
 * validate/unique + luồng SỬA đã có ở members.integration.test.ts.)
 *
 * Chạy dưới admin storageState (project chromium mặc định). DB = e2e/local.db.
 */

const NAME = "E2E Uname Create";
const TYPED = "E2EUname"; // nhập hoa → phải lưu lowercase
const STORED = "e2euname";

function db() {
  return createClient({ url: "file:e2e/local.db" });
}

test.beforeAll(async () => {
  const c = db();
  await c.execute({ sql: "DELETE FROM members WHERE name = ?", args: [NAME] });
  await c.execute({
    sql: "DELETE FROM members WHERE username = ?",
    args: [STORED],
  });
  c.close();
});

test("admin tạo member kèm username → lưu lowercase (UI → action → DB)", async ({
  page,
}) => {
  await page.goto("/admin/members", { waitUntil: "domcontentloaded" });

  // Mở dialog "Thêm thành viên" (nút header hiện ở viewport desktop).
  await page.getByRole("button", { name: "Thêm thành viên" }).first().click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator("#name").fill(NAME);
  await dialog.locator("#username").fill(TYPED);
  await dialog.locator('button[type="submit"]').click();

  // Verify tận DB: đúng 1 member tên đó, username đã lowercase.
  await expect
    .poll(
      async () => {
        const c = db();
        const r = await c.execute({
          sql: "SELECT username FROM members WHERE name = ?",
          args: [NAME],
        });
        c.close();
        return r.rows[0]?.username ?? null;
      },
      { timeout: 10_000, intervals: [300, 500, 800] },
    )
    .toBe(STORED);
});

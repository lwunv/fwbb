import { test, expect } from "@playwright/test";
import { createClient } from "@libsql/client";

// Chuông thông báo cạnh logo Admin + trang /admin/notifications (yêu cầu user
// 6/11/2026). Member RIÊNG của bài, nợ 188.000 (quá hạn mức 100.000).

const NAME = "E2E Chuông Nợ";
const KEY = "e2e-admin-bell-debt";

function db() {
  return createClient({ url: "file:e2e/local.db" });
}

let memberId: number;

async function cleanup(c: ReturnType<typeof db>) {
  await c.execute({
    sql: "DELETE FROM financial_transactions WHERE idempotency_key = ?",
    args: [KEY],
  });
  await c.execute({ sql: "DELETE FROM members WHERE name = ?", args: [NAME] });
}

test.beforeAll(async () => {
  const c = db();
  await c.execute("PRAGMA busy_timeout = 5000");
  await cleanup(c);
  const m = await c.execute({
    sql: "INSERT INTO members (name, is_active, approval_status) VALUES (?, 1, 'approved')",
    args: [NAME],
  });
  memberId = Number(m.lastInsertRowid);
  await c.execute({
    sql: "INSERT INTO financial_transactions (type, direction, amount, member_id, idempotency_key, description) VALUES ('fund_deduction','out',188000,?,?,'Chốt sổ buổi e2e')",
    args: [memberId, KEY],
  });
  c.close();
});

test.afterAll(async () => {
  const c = db();
  await c.execute("PRAGMA busy_timeout = 5000");
  await cleanup(c);
  c.close();
});

test("chuông cạnh logo có số, mở ra thấy member nợ, sang trang thông báo xem lịch sử", async ({
  page,
}) => {
  await page.goto("/admin/dashboard", { waitUntil: "domcontentloaded" });
  // Desktop: chuông trong sidebar (mobile nav ẩn ở lg).
  const bell = page
    .getByRole("button", { name: /^Thông báo, \d+ thành viên đang âm quỹ$/ })
    .last();
  await expect(bell).toBeVisible({ timeout: 20_000 });
  await bell.click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText(NAME)).toBeVisible({ timeout: 10_000 });
  // Desktop: ngăn trượt ra NGAY SAU sidebar (rộng 240px), không che sidebar
  // (yêu cầu user 6/11/2026). Sidebar vẫn bấm được khi ngăn đang mở.
  await expect
    .poll(async () => (await sheet.boundingBox())?.x ?? -1, { timeout: 5_000 })
    .toBeGreaterThanOrEqual(239);
  await page
    .getByRole("link", { name: /Thành viên/ })
    .first()
    .click({ trial: true, timeout: 5_000 });
  await expect(
    sheet.locator("li", { hasText: NAME }).getByText("Quá hạn mức"),
  ).toBeVisible();

  // Bấm chuông lần nữa thì đóng ngăn, bấm tiếp thì mở lại (user 6/11/2026).
  await bell.click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 5_000 });
  await expect(bell).toHaveAttribute("aria-expanded", "false");
  await bell.click();
  await expect(sheet.getByText(NAME)).toBeVisible({ timeout: 10_000 });

  // Bấm 1 dòng trong chuông → sang sổ quỹ đã lọc sẵn tên member đó.
  await sheet.getByRole("link", { name: new RegExp(NAME) }).click();
  await expect(page).toHaveURL(/\/admin\/fund\/transactions\?q=/);
  await expect(
    page.getByRole("searchbox").or(page.getByPlaceholder(/Tìm/)).first(),
  ).toHaveValue(NAME);

  // Mở lại chuông, sang trang thông báo.
  await bell.click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Xem tất cả thông báo" })
    .click();
  await expect(page).toHaveURL(/\/admin\/notifications$/);
  // Tab mặc định "Hoạt động": dòng kiểu Facebook "<tên> vừa âm quỹ".
  const item = page.locator("li", { hasText: `${NAME} vừa âm quỹ` });
  await expect(item).toBeVisible({ timeout: 10_000 });
  await expect(item).toContainText("Chốt sổ buổi e2e");
  await expect(item).toContainText("-188.000");

  // Tìm theo tên + tab "Đang nợ" lọc "Quá hạn mức" vẫn thấy member này.
  await page.getByPlaceholder("Tìm theo tên hoặc biệt danh").fill("chuong no");
  await page.getByRole("tab", { name: /Đang nợ/ }).click();
  await page.getByRole("tab", { name: "Quá hạn mức" }).click();
  await expect(page.locator("li", { hasText: NAME })).toBeVisible();
  await expect(page).toHaveURL(/tab=owing/);
});

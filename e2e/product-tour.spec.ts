import { test, expect } from "@playwright/test";
import { createClient } from "@libsql/client";
import bcrypt from "bcryptjs";

// Logged-out context — tour chỉ có trong layout của member đã đăng nhập.
test.use({ storageState: { cookies: [], origins: [] } });

const EMAIL = "e2etour@example.com";
const PASSWORD = "producttour123";

/** T6 của tuần đích (T7/CN → tuần sau): luôn là hôm nay hoặc tương lai. */
function targetFriday(): string {
  const vn = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  const base = new Date(`${vn(new Date())}T12:00:00+07:00`);
  const dow = base.getUTCDay();
  const fromMon = (d: number) => (d === 0 ? 6 : d - 1);
  const shift = dow === 6 || dow === 0 ? 7 : 0;
  return vn(
    new Date(base.getTime() + (-fromMon(dow) + shift + 4) * 86_400_000),
  );
}

test.beforeAll(async () => {
  const c = createClient({ url: "file:e2e/local.db" });
  await c.execute("PRAGMA busy_timeout = 5000");
  const m = (
    await c.execute(
      "SELECT id FROM members WHERE is_active=1 AND approval_status='approved' ORDER BY id DESC LIMIT 1",
    )
  ).rows[0];
  const hash = await bcrypt.hash(PASSWORD, 10);
  await c.execute({
    sql: "UPDATE members SET email = NULL WHERE email = ?",
    args: [EMAIL],
  });
  await c.execute({
    // Member này có thể đang mang mật khẩu tạm (đã hết hạn) do bài reset mật
    // khẩu để lại → xoá cờ, nếu không login bị từ chối.
    sql: "UPDATE members SET password_hash=?, email=?, must_change_password=0, password_reset_expires_at=NULL WHERE id=?",
    args: [hash, EMAIL, m.id],
  });
  // Hết nợ → vào nhánh có selector + thanh vote (member nợ lớn bị chặn vote).
  await c.execute("DELETE FROM financial_transactions WHERE member_id=?", [
    m.id,
  ]);
  await c.execute("DELETE FROM rate_limit_buckets");

  const date = targetFriday();
  const court = (await c.execute("SELECT id FROM courts LIMIT 1")).rows[0];
  const open = (
    await c.execute({
      sql: "SELECT id FROM sessions WHERE date=? AND status='voting'",
      args: [date],
    })
  ).rows[0];
  if (!open) {
    const dl = new Date(Date.now() + 6 * 3600 * 1000);
    const p = (n: number) => String(n).padStart(2, "0");
    const deadline = `${dl.getFullYear()}-${p(dl.getMonth() + 1)}-${p(dl.getDate())}T${p(dl.getHours())}:${p(dl.getMinutes())}:${p(dl.getSeconds())}`;
    await c.execute({
      sql: `INSERT INTO sessions (date, start_time, end_time, court_id, court_quantity, court_price, status, vote_deadline)
            VALUES (?, '20:30', '22:30', ?, 1, 200000, 'voting', ?)`,
      args: [date, court?.id ?? null, deadline],
    });
  }
  c.close();
});

test.beforeEach(async ({ page }) => {
  await page.route(
    /connect\.facebook\.net|accounts\.google\.com|apis\.google\.com|gsi\//,
    (r) => r.abort(),
  );
});

test("product tour đi qua vote + từng mục trong menu (tự mở ngăn kéo)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const identifier = page.getByPlaceholder("Username / SĐT / Email");
  await expect(identifier).toBeVisible({ timeout: 20_000 });
  await identifier.fill(EMAIL);
  await page.getByPlaceholder("Mật khẩu (≥ 8 ký tự)").fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  // Mặc định có thể chọn buổi hôm nay (đã đóng vote) → chọn chip T6 (chip
  // cuối) là buổi đang mở mà beforeAll đảm bảo có.
  const chips = page.locator('[data-tour="week-days"] button');
  await expect(chips.first()).toBeVisible({ timeout: 15_000 });
  await chips.last().click();
  await expect(page.locator('[data-tour="vote-play"]')).toBeVisible({
    timeout: 15_000,
  });

  await page.locator('[data-tour="nav-menu"]').click();
  await page.locator('[data-tour="nav-guide"]').click();

  const popover = page.locator(".driver-popover");
  const title = page.locator(".driver-popover-title");
  // Tiêu đề step trong ngăn kéo → mục menu phải được highlight ở step đó.
  const drawerSteps: Record<string, string> = {
    "Lịch sử": "nav-history",
    "Quỹ & Nợ": "nav-fund",
    "Thống kê": "nav-stats",
    "Trang cá nhân": "nav-me",
    "Xem lại hướng dẫn": "nav-guide",
  };
  const seen: string[] = [];
  const drawerAnchors: string[] = [];
  for (let i = 0; i < 30; i++) {
    await expect(popover).toBeVisible({ timeout: 5_000 });
    const text = (await title.textContent())?.trim() ?? "";
    seen.push(text);
    // Bộ đếm dạng số "n/16", không phải "n of 16" tiếng Anh.
    await expect(page.locator(".driver-popover-progress-text")).toHaveText(
      `${i + 1}/16`,
    );
    const key = drawerSteps[text];
    if (key) {
      // Ngăn kéo đã mở thật + đúng mục đang được highlight.
      const item = page.locator(`[data-tour="${key}"]`);
      await expect(item).toBeInViewport();
      await expect(item).toHaveClass(/driver-active-element/);
      drawerAnchors.push(key);
    }
    const next = page.locator(".driver-popover-next-btn");
    await next.click();
    // Step cuối: bấm Xong → tour đóng.
    if ((await popover.count()) === 0) break;
    await expect(title).not.toHaveText(text, { timeout: 5_000 });
  }

  await expect(popover).toHaveCount(0);
  expect(drawerAnchors).toEqual([
    "nav-history",
    "nav-fund",
    "nav-stats",
    "nav-me",
    "nav-guide",
  ]);
  for (const t of [
    "Chọn ngày chơi",
    "Đi chơi cầu",
    "Đi 2 người",
    "Đi nhậu",
    "Danh sách đi",
    "Ngôn ngữ & giao diện",
    "Menu",
    "Xong rồi! 🎉",
  ]) {
    expect(seen).toContain(t);
  }
  // Tour xong → ngăn kéo đóng lại, trang dùng bình thường.
  await expect(page.locator('[data-tour="nav-history"]')).toHaveCount(0);
  await page.locator('[data-tour="nav-menu"]').click();
  await expect(page.locator('[data-tour="nav-history"]')).toBeVisible();
});

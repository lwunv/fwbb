import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@libsql/client";
import bcrypt from "bcryptjs";

// Logged-out context — tour chỉ có trong layout của member đã đăng nhập.
// Điện thoại (cảm ứng): tour dùng chủ yếu trên mobile.
test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 375, height: 667 },
  isMobile: true,
  hasTouch: true,
});

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

/** Login, chọn buổi đang mở vote (chip T6), mở tour qua menu > Hướng dẫn. */
async function openTour(page: Page) {
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
  await chips.last().tap();
  await expect(page.locator('[data-tour="vote-play"]')).toBeVisible({
    timeout: 15_000,
  });
  await page.locator('[data-tour="nav-menu"]').tap();
  await page.locator('[data-tour="nav-guide"]').tap();
  await expect(page.locator(".driver-popover")).toBeVisible({
    timeout: 5_000,
  });
}

/** Tour đã đóng hẳn: không còn khung, ngăn kéo đóng, trang bấm được. */
async function expectTourClosed(page: Page) {
  await expect(page.locator(".driver-popover")).toHaveCount(0);
  await expect(page.locator('[data-tour="nav-history"]')).toHaveCount(0);
  await page.locator('[data-tour="nav-menu"]').tap();
  await expect(page.locator('[data-tour="nav-history"]')).toBeVisible();
}

test("product tour đi qua vote + từng mục trong menu (tự mở ngăn kéo)", async ({
  page,
}) => {
  await openTour(page);
  const popover = page.locator(".driver-popover");
  const title = page.locator(".driver-popover-title");

  // Step chào: nút "Bắt đầu" + "Bỏ qua", không có "Trước".
  await expect(title).toHaveText("Chào mừng đến FWBB! 🏸");
  await expect(page.locator(".driver-popover-next-btn")).toHaveText("Bắt đầu");
  await expect(page.locator(".fwbb-tour-skip")).toHaveText("Bỏ qua");
  await expect(page.locator(".driver-popover-prev-btn")).toBeHidden();

  // Tiêu đề step trong ngăn kéo → mục menu phải được highlight ở step đó.
  const drawerSteps: Record<string, string> = {
    "Lịch sử": "nav-history",
    "Quỹ & Nợ": "nav-fund",
    "Thống kê": "nav-stats",
    Sân: "nav-venues",
    "Trang cá nhân": "nav-me",
    "Xem lại hướng dẫn": "nav-guide",
  };
  const seen: string[] = [];
  const drawerAnchors: string[] = [];
  for (let i = 0; i < 30; i++) {
    await expect(popover).toBeVisible({ timeout: 5_000 });
    const text = (await title.textContent())?.trim() ?? "";
    seen.push(text);
    // Bộ đếm dạng số "n/N", không phải "n of N" tiếng Anh.
    await expect(page.locator(".driver-popover-progress-text")).toHaveText(
      new RegExp(`^${i + 1}/[0-9]+$`),
    );
    // Nút Tiếp đủ lớn để chạm bằng ngón tay (≥44px).
    const next = page.locator(".driver-popover-next-btn");
    expect((await next.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    const key = drawerSteps[text];
    if (key) {
      // Ngăn kéo đã mở thật + đúng mục đang được highlight.
      const item = page.locator(`[data-tour="${key}"]`);
      await expect(item).toBeInViewport();
      await expect(item).toHaveClass(/driver-active-element/);
      drawerAnchors.push(key);
    }
    await next.tap();
    // Step cuối: bấm Xong → tour đóng.
    if ((await popover.count()) === 0) break;
    await expect(title).not.toHaveText(text, { timeout: 5_000 });
  }

  expect(drawerAnchors).toEqual(Object.values(drawerSteps));
  for (const t of [
    "Chọn ngày chơi",
    "Sân chơi",
    "Đi chơi cầu",
    "Đi nhậu",
    "Danh sách đi",
    "Ngôn ngữ & giao diện",
    "Menu",
    "Xong rồi! 🎉",
  ]) {
    expect(seen).toContain(t);
  }
  // Chưa tick chơi cầu thì switch 👫 chưa có → không có step chỉ vào ô trống.
  expect(seen).not.toContain("Đi 2 người");
  await expectTourClosed(page);
});

test("bỏ qua tour bằng nút Bỏ qua (kể cả khi đang ở trong menu)", async ({
  page,
}) => {
  await openTour(page);
  // Đi tới step đầu tiên trong ngăn kéo rồi bấm Bỏ qua.
  for (let i = 0; i < 20; i++) {
    if (
      (await page.locator(".driver-popover-title").textContent()) === "Lịch sử"
    )
      break;
    await page.locator(".driver-popover-next-btn").tap();
    await page.waitForTimeout(150);
  }
  await expect(page.locator('[data-tour="nav-history"]')).toBeInViewport();
  await page.locator(".fwbb-tour-skip").tap();
  await expectTourClosed(page);
});

test("đóng tour bằng nút X", async ({ page }) => {
  await openTour(page);
  const close = page.locator(".driver-popover-close-btn");
  const box = await close.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await close.tap();
  await expectTourClosed(page);
});

test("chạm ra ngoài khung (vùng tối) thì đóng tour", async ({ page }) => {
  await openTour(page);
  // Góc dưới trái: nằm ngoài khung chào (canh giữa) → trúng lớp phủ tối.
  await page.mouse.click(12, 640);
  await expectTourClosed(page);
});

// /san nằm ở route group (exchange), trang chủ ở (public): đi /san → / là đổi
// layout nên ngăn kéo menu bị dựng lại, ý định mở tour phải sống qua lần đó.
test("từ /san mở menu, bấm Hướng dẫn → về / và thấy bước tour đầu tiên", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const identifier = page.getByPlaceholder("Username / SĐT / Email");
  await expect(identifier).toBeVisible({ timeout: 20_000 });
  await identifier.fill(EMAIL);
  await page.getByPlaceholder("Mật khẩu (≥ 8 ký tự)").fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('[data-tour="nav-menu"]')).toBeVisible({
    timeout: 15_000,
  });

  await page.goto("/san", { waitUntil: "domcontentloaded" });
  await page.locator('[data-tour="nav-menu"]').click();
  await page.locator('[data-tour="nav-guide"]').click();

  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  await expect(page.locator(".driver-popover")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator(".driver-popover-title")).toHaveText(
    "Chào mừng đến FWBB! 🏸",
  );
  await expect(page.locator(".driver-popover-progress-text")).toHaveText(
    /^1\/\d+$/,
  );
});

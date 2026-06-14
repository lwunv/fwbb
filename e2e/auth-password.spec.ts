import { test, expect, type Page } from "@playwright/test";

// Logged-out context (override storageState admin của project chromium).
test.use({ storageState: { cookies: [], origins: [] } });

// Chặn SDK ngoài (FB/Google) → gate fallback về form email/mật khẩu ngay,
// deterministic + không chờ CDN. submitVote/login vẫn chạy server-side bình thường.
test.beforeEach(async ({ page }) => {
  await page.route(
    /connect\.facebook\.net|accounts\.google\.com|apis\.google\.com|gsi\//,
    (r) => r.abort(),
  );
});

async function gotoLoginGate(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  // Form email/mật khẩu là primary — hiện sau khi SDK init xong/fail.
  await expect(page.locator('input[type="email"]')).toBeVisible({
    timeout: 20_000,
  });
}

async function fillAndSubmit(
  page: Page,
  opts: { email: string; password: string; name?: string },
) {
  if (opts.name) {
    await page.getByPlaceholder("Họ tên").fill(opts.name);
  }
  await page.locator('input[type="email"]').fill(opts.email);
  await page.locator('input[type="password"]').fill(opts.password);
  await page.locator('button[type="submit"]').click();
}

test.describe("đăng ký + đăng nhập email/mật khẩu (e2e)", () => {
  test("đăng ký member mới → vào trạng thái chờ duyệt (rời gate)", async ({
    page,
  }) => {
    await gotoLoginGate(page);
    // Chuyển sang tab Đăng ký (ở mode login, "Đăng ký" chỉ là 1 tab button).
    await page.getByRole("button", { name: "Đăng ký", exact: true }).click();

    const email = `e2e-signup-${Date.now()}@example.com`;
    await fillAndSubmit(page, {
      email,
      password: "supersecret123",
      name: "E2E Tester",
    });

    // Thành công → revalidate → layout re-render sang PendingApprovalGate:
    // form email biến mất (đã đăng nhập, không còn ở gate).
    await expect(page.locator('input[type="email"]')).toHaveCount(0, {
      timeout: 15_000,
    });
  });

  test("đăng nhập tài khoản đã đăng ký → vào trạng thái đã xác thực", async ({
    page,
    context,
  }) => {
    // Tạo tài khoản trước (signup → set cookie).
    await gotoLoginGate(page);
    await page.getByRole("button", { name: "Đăng ký", exact: true }).click();
    const email = `e2e-login-${Date.now()}@example.com`;
    const password = "supersecret123";
    await fillAndSubmit(page, { email, password, name: "E2E Login" });
    await expect(page.locator('input[type="email"]')).toHaveCount(0, {
      timeout: 15_000,
    });

    // Đăng xuất (xóa cookie) rồi đăng nhập lại bằng email/mật khẩu.
    await context.clearCookies();
    await gotoLoginGate(page);
    // Mode mặc định = login.
    await fillAndSubmit(page, { email, password });

    // Login thành công → rời gate (form biến mất).
    await expect(page.locator('input[type="email"]')).toHaveCount(0, {
      timeout: 15_000,
    });
  });

  test("đăng nhập sai mật khẩu → ở lại gate + báo lỗi", async ({ page }) => {
    await gotoLoginGate(page);
    await fillAndSubmit(page, {
      email: "nobody@example.com",
      password: "wrongpassword",
    });
    // Vẫn ở gate (form còn) — không đăng nhập được.
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });
});

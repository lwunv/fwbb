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
  // Form login giờ ở /login (route "/" là lịch công khai cho khách).
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  // Mode mặc định = login — ô định danh đa kênh (username/sđt/email), KHÔNG
  // phải input[type=email] (chỉ tồn tại ở mode đăng ký).
  await expect(page.getByPlaceholder("Username / SĐT / Email")).toBeVisible({
    timeout: 20_000,
  });
}

async function fillAndSubmit(
  page: Page,
  opts: {
    email: string;
    password: string;
    name?: string;
    mode?: "login" | "signup";
  },
) {
  const mode = opts.mode ?? "login";
  if (mode === "signup") {
    if (opts.name) {
      await page.getByPlaceholder("Họ tên").fill(opts.name);
    }
    // Signup: ô email riêng (type=email).
    await page.locator('input[type="email"]').fill(opts.email);
  } else {
    // Login: 1 ô định danh đa kênh (username/sđt/email) — type=text.
    await page.getByPlaceholder("Username / SĐT / Email").fill(opts.email);
  }
  await page.getByPlaceholder("Mật khẩu (≥ 8 ký tự)").fill(opts.password);
  await page.locator('button[type="submit"]').click();
}

/** Rời gate hẳn (đăng nhập/đăng ký thành công) → không còn form nào, bất kể mode. */
async function assertLeftGate(page: Page) {
  await expect(page.getByPlaceholder("Username / SĐT / Email")).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(page.locator('input[type="email"]')).toHaveCount(0);
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
      mode: "signup",
    });

    // Thành công → revalidate → layout re-render sang PendingApprovalGate:
    // form biến mất (đã đăng nhập, không còn ở gate).
    await assertLeftGate(page);
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
    await fillAndSubmit(page, {
      email,
      password,
      name: "E2E Login",
      mode: "signup",
    });
    await assertLeftGate(page);

    // Đăng xuất (xóa cookie) rồi đăng nhập lại bằng email/mật khẩu.
    await context.clearCookies();
    await gotoLoginGate(page);
    // Mode mặc định = login.
    await fillAndSubmit(page, { email, password, mode: "login" });

    // Login thành công → rời gate (form biến mất).
    await assertLeftGate(page);
  });

  test("đăng nhập sai mật khẩu → ở lại gate + báo lỗi", async ({ page }) => {
    await gotoLoginGate(page);
    await fillAndSubmit(page, {
      email: "nobody@example.com",
      password: "wrongpassword",
      mode: "login",
    });
    // Vẫn ở gate (ô định danh còn) — không đăng nhập được.
    await expect(page.getByPlaceholder("Username / SĐT / Email")).toBeVisible();
  });
});

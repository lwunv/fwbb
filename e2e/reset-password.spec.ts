import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@libsql/client";
import bcrypt from "bcryptjs";

/**
 * E2E cho luồng admin-reset mật khẩu (mật khẩu tạm dùng 1 lần):
 *  - Login bằng mật khẩu tạm → BẮT đổi mật khẩu mới (gate chặn toàn app, không
 *    vào vote được) trước khi dùng.
 *  - Member KHÔNG có email vẫn đổi được (regression: trước đây bị đòi email →
 *    kẹt, phải xài temp mãi).
 *  - Member CÓ email cũng bị bắt đổi + đổi được.
 *  - Sau đổi: login bằng mật khẩu MỚI được; mật khẩu tạm CŨ hết tác dụng.
 *  - Mật khẩu tạm HẾT hạn → login bị từ chối.
 *
 * DB: file e2e/local.db (webServer trỏ vào, KHÔNG đụng prod). Seed member test
 * trực tiếp vào DB trong beforeAll cho deterministic (admin UI không set được
 * username/temp state).
 */

test.use({ storageState: { cookies: [], origins: [] } });

// Chặn SDK OAuth ngoài → gate fallback về form email/mật khẩu (deterministic).
test.beforeEach(async ({ page }) => {
  await page.route(
    /connect\.facebook\.net|accounts\.google\.com|apis\.google\.com|gsi\//,
    (r) => r.abort(),
  );
});

const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 60 * 60 * 1000).toISOString();

const SEED = [
  {
    name: "E2E Reset NoEmail",
    username: "e2ereset",
    email: null,
    temp: "TempPass99",
    must: 1,
    expires: FUTURE,
  },
  {
    name: "E2E Reset Email",
    username: "e2eremail",
    email: "e2eremail@example.com",
    temp: "TempPassEml9",
    must: 1,
    expires: FUTURE,
  },
  {
    name: "E2E Reset Expired",
    username: "e2erexp",
    email: null,
    temp: "ExpiredPass9",
    must: 1,
    expires: PAST,
  },
];

test.beforeAll(async () => {
  const db = createClient({ url: "file:e2e/local.db" });
  // Reset rate-limit để nhiều lần login trong suite không bị chặn.
  await db.execute("DELETE FROM rate_limit_buckets").catch(() => {});
  for (const m of SEED) {
    await db.execute({
      sql: "DELETE FROM members WHERE username = ?",
      args: [m.username],
    });
    const hash = bcrypt.hashSync(m.temp, 12);
    await db.execute({
      sql: `INSERT INTO members
        (name, username, email, password_hash, must_change_password,
         password_reset_expires_at, approval_status, is_active, default_with_partner)
        VALUES (?, ?, ?, ?, ?, ?, 'approved', 1, 0)`,
      args: [m.name, m.username, m.email, hash, m.must, m.expires],
    });
  }
  db.close();
});

const ID_PLACEHOLDER = "Username / SĐT / Email";
const PW_PLACEHOLDER = "Mật khẩu (≥ 8 ký tự)";
// Tiêu đề gate là <h2>; dùng role=heading để không khớp nhầm câu body (cũng
// chứa cụm "đặt mật khẩu mới").
const gate = (page: Page) =>
  page.getByRole("heading", { name: "Đặt mật khẩu mới" });

async function gotoLoginForm(page: Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.getByPlaceholder(ID_PLACEHOLDER)).toBeVisible({
    timeout: 20_000,
  });
}

async function submitLogin(page: Page, identifier: string, password: string) {
  await page.getByPlaceholder(ID_PLACEHOLDER).fill(identifier);
  await page.getByPlaceholder(PW_PLACEHOLDER).fill(password);
  await page.locator('button[type="submit"]').click();
}

async function setNewPasswordAtGate(page: Page, newPw: string) {
  await expect(gate(page)).toBeVisible({ timeout: 15_000 });
  await page.getByPlaceholder("Mật khẩu mới (≥ 8 ký tự)").fill(newPw);
  await page.getByPlaceholder("Nhập lại mật khẩu mới").fill(newPw);
  await page.getByRole("button", { name: "Đổi mật khẩu" }).click();
  // Đổi xong → gate biến mất (vào app bình thường).
  await expect(gate(page)).toHaveCount(0, { timeout: 15_000 });
}

test.describe("reset mật khẩu (mật khẩu tạm) — e2e", () => {
  test("member KHÔNG email: login temp → bắt đổi → đổi được → login lại bằng pass mới; temp cũ hết tác dụng", async ({
    page,
    context,
  }) => {
    const NEW_PW = "MyFreshPass123";

    // 1. Login bằng mật khẩu tạm → BẮT đổi (gate chặn app).
    await gotoLoginForm(page);
    await submitLogin(page, "e2ereset", "TempPass99");
    await expect(gate(page)).toBeVisible({ timeout: 15_000 });
    // Bằng chứng bị chặn: KHÔNG có bottom-nav/app, chỉ có form đổi mật khẩu.
    await expect(
      page.getByPlaceholder("Mật khẩu mới (≥ 8 ký tự)"),
    ).toBeVisible();

    // 2. Đặt mật khẩu mới (không phải nhập email) → vào app.
    await setNewPasswordAtGate(page, NEW_PW);

    // 3. Logout + login lại bằng mật khẩu MỚI → vào thẳng, không còn gate.
    await context.clearCookies();
    await gotoLoginForm(page);
    await submitLogin(page, "e2ereset", NEW_PW);
    await expect(page.getByPlaceholder(ID_PLACEHOLDER)).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(gate(page)).toHaveCount(0);

    // 4. Mật khẩu tạm CŨ không còn dùng được → ở lại form login.
    await context.clearCookies();
    await gotoLoginForm(page);
    await submitLogin(page, "e2ereset", "TempPass99");
    await expect(page.getByPlaceholder(ID_PLACEHOLDER)).toBeVisible();
    await expect(gate(page)).toHaveCount(0);
  });

  test("member CÓ email: login temp → bắt đổi → đổi được", async ({ page }) => {
    await gotoLoginForm(page);
    await submitLogin(page, "e2eremail", "TempPassEml9");
    await setNewPasswordAtGate(page, "EmailUserPass123");
  });

  test("mật khẩu tạm HẾT hạn → login bị từ chối", async ({ page }) => {
    await gotoLoginForm(page);
    await submitLogin(page, "e2erexp", "ExpiredPass9");
    // Không vào được: vẫn ở form login, có báo lỗi hết hạn.
    await expect(page.getByPlaceholder(ID_PLACEHOLDER)).toBeVisible();
    await expect(page.getByText(/hết hạn/i)).toBeVisible({ timeout: 10_000 });
    await expect(gate(page)).toHaveCount(0);
  });
});

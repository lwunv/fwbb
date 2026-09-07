import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@libsql/client";
import bcrypt from "bcryptjs";

// Member login (không phải admin) — ghi đè storageState admin của project
// chromium, giống week-selector.spec.ts / auth-password.spec.ts.
test.use({ storageState: { cookies: [], origins: [] } });

const EMAIL = "e2e-vote-contact@example.com";
const PASSWORD = "votecontact123";
// Ngày xa tương lai, không đụng session thật/session của bài test khác.
const TEST_DATE = "2099-06-01";

async function db() {
  const c = createClient({ url: "file:e2e/local.db" });
  // Fixture và server Next mở CÙNG file e2e/local.db, nên ghi đồng thời làm
  // SQLITE_BUSY. Chờ lock nhả thay vì chết ngay. Cùng cách src/db/test-db.ts
  // đã dùng cho test tích hợp.
  await c.execute("PRAGMA busy_timeout = 5000");
  return c;
}

let sessionId: number;

test.beforeAll(async () => {
  const c = await db();
  const m = (
    await c.execute(
      "SELECT id FROM members WHERE is_active=1 AND approval_status='approved' ORDER BY id LIMIT 1",
    )
  ).rows[0];
  const hash = await bcrypt.hash(PASSWORD, 10);
  await c.execute({
    sql: "UPDATE members SET password_hash=?, email=? WHERE id=?",
    args: [hash, EMAIL, m.id],
  });
  await c.execute("DELETE FROM rate_limit_buckets");

  await c.execute("DELETE FROM sessions WHERE date=?", [TEST_DATE]);
  const inserted = await c.execute({
    sql: "INSERT INTO sessions (date, status) VALUES (?, 'voting')",
    args: [TEST_DATE],
  });
  sessionId = Number(inserted.lastInsertRowid);
  c.close();
});

test.afterAll(async () => {
  const c = await db();
  await c.execute("DELETE FROM sessions WHERE date=?", [TEST_DATE]);
  await c.execute(
    "DELETE FROM app_settings WHERE key IN ('contactHotline','contactEmail')",
  );
  c.close();
});

// Chặn SDK ngoài → gate fallback về form email/mật khẩu ngay, deterministic.
test.beforeEach(async ({ page }) => {
  await page.route(
    /connect\.facebook\.net|accounts\.google\.com|apis\.google\.com|gsi\//,
    (r) => r.abort(),
  );
});

async function loginAsMember(page: Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const identifier = page.getByPlaceholder("Username / SĐT / Email");
  await expect(identifier).toBeVisible({ timeout: 20_000 });
  await identifier.fill(EMAIL);
  await page.getByPlaceholder("Mật khẩu (≥ 8 ký tự)").fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(identifier).toHaveCount(0, { timeout: 15_000 });
}

/** Ghi thẳng app_settings — value rỗng nghĩa là xoá key (khớp hành vi "chưa
 *  cấu hình" mà registry đọc ra default ""). */
async function setContactSettings(hotline: string, email: string) {
  const c = await db();
  if (hotline) {
    await c.execute({
      sql: "INSERT INTO app_settings (key, value) VALUES ('contactHotline', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      args: [JSON.stringify(hotline)],
    });
  } else {
    await c.execute("DELETE FROM app_settings WHERE key='contactHotline'");
  }
  if (email) {
    await c.execute({
      sql: "INSERT INTO app_settings (key, value) VALUES ('contactEmail', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      args: [JSON.stringify(email)],
    });
  } else {
    await c.execute("DELETE FROM app_settings WHERE key='contactEmail'");
  }
  c.close();
}

test.describe("khối liên hệ ở màn vote", () => {
  // Ca chặn hồi quy quan trọng nhất: hôm nay chưa ai cấu hình nên đa số
  // member đang ở trạng thái này — màn vote của họ không được đổi gì cả.
  test("chưa cấu hình gì → không có khối liên hệ nào", async ({ page }) => {
    await setContactSettings("", "");
    await loginAsMember(page);
    await page.goto(`/vote/${sessionId}`, { waitUntil: "domcontentloaded" });

    await expect(page.getByText("Liên hệ hỗ trợ")).toHaveCount(0);
    await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
    await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0);
  });

  test("cấu hình cả hai → khối hiện, liên kết tel: và mailto: đúng giá trị, không bị thanh sticky che", async ({
    page,
  }) => {
    await setContactSettings("0987654321", "hotro@fwbb.club");
    await loginAsMember(page);
    await page.goto(`/vote/${sessionId}`, { waitUntil: "domcontentloaded" });

    const telLink = page.locator('a[href="tel:0987654321"]');
    const mailLink = page.locator('a[href="mailto:hotro@fwbb.club"]');
    await expect(page.getByText("Liên hệ hỗ trợ")).toBeVisible();
    await expect(telLink).toBeVisible();
    await expect(mailLink).toBeVisible();

    // Buổi status='voting', không deadline → thanh sticky vote bar (fixed,
    // z-40) luôn hiện ở đáy màn hình cho member đã login — đúng trạng thái
    // đa số member gặp khi mở link vote. `click({ trial: true })` chạy đủ
    // actionability check của Playwright (visible + stable + KHÔNG có phần
    // tử khác chặn tại điểm click) mà không thật sự bấm — nếu thanh sticky
    // đè lên link này, bước trial-click sẽ timeout/fail ngay đây.
    await telLink.click({ trial: true, timeout: 5_000 });
    await mailLink.click({ trial: true, timeout: 5_000 });
  });

  test("chỉ cấu hình một cái → chỉ hiện cái đã có", async ({ page }) => {
    await setContactSettings("0987654321", "");
    await loginAsMember(page);
    await page.goto(`/vote/${sessionId}`, { waitUntil: "domcontentloaded" });

    const telLink = page.locator('a[href="tel:0987654321"]');
    await expect(telLink).toBeVisible();
    await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0);
    await telLink.click({ trial: true, timeout: 5_000 });
  });
});

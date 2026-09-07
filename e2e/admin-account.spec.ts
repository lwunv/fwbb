import { test, expect } from "@playwright/test";
import { createClient } from "@libsql/client";

// Chỉ sửa PHONE (an toàn — không đổi username/email của admin đang đăng nhập,
// tránh làm hỏng login cho các test khác). DB e2e/local.db.
async function db() {
  const c = createClient({ url: "file:e2e/local.db" });
  // Fixture và server Next mở CÙNG file e2e/local.db, nên ghi đồng thời làm
  // SQLITE_BUSY. Chờ lock nhả thay vì chết ngay. Cùng cách src/db/test-db.ts
  // đã dùng cho test tích hợp.
  await c.execute("PRAGMA busy_timeout = 5000");
  return c;
}

test("admin sửa SĐT ở /admin/account → lưu vào DB (UI → action → DB)", async ({
  page,
}) => {
  const PHONE = "0987000111";
  await page.goto("/admin/account", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Tài khoản" })).toBeVisible();

  const phone = page.locator("#phoneNumber");
  await phone.fill(PHONE);
  await page.getByRole("button", { name: "Lưu" }).click();

  await expect
    .poll(
      async () => {
        const c = await db();
        const r = await c.execute("SELECT phone_number FROM admins LIMIT 1");
        c.close();
        return r.rows[0]?.phone_number ?? null;
      },
      { timeout: 10_000, intervals: [300, 500, 800] },
    )
    .toBe(PHONE);
});

test("form đổi mật khẩu: sai mật khẩu hiện tại → báo lỗi, KHÔNG đổi", async ({
  page,
}) => {
  await page.goto("/admin/account", { waitUntil: "domcontentloaded" });
  await page.locator("#currentPassword").fill("definitely-wrong-pass");
  await page.locator("#newPassword").fill("brandnewpass123");
  await page.locator("#confirmPassword").fill("brandnewpass123");
  // Nút submit của card đổi mật khẩu (passwordChange.submit = "Đổi mật khẩu").
  await page.getByRole("button", { name: "Đổi mật khẩu" }).click();
  // Lỗi serverErrors.wrongCurrentPassword = "Mật khẩu hiện tại không đúng"
  // → xác nhận form đã nối đúng action changePassword, KHÔNG đổi mật khẩu thật.
  await expect(page.getByText("Mật khẩu hiện tại không đúng")).toBeVisible({
    timeout: 10_000,
  });
});

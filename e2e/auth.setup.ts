import { test as setup } from "@playwright/test";
import { loginAsAdmin } from "./utils";

const adminFile = "e2e/.auth/admin.json";

// Đăng nhập admin MỘT lần, lưu session → mọi spec dùng lại (tránh login mỗi
// test bị rate-limit + tăng tốc).
setup("authenticate as admin", async ({ page }) => {
  await loginAsAdmin(page);
  await page.context().storageState({ path: adminFile });
});

import { test as setup, expect } from "@playwright/test";
import { PROD_STORAGE_STATE } from "./prod-storage-path";

/**
 * Đăng nhập admin trên PROD ĐÚNG MỘT LẦN rồi lưu phiên cho mọi bài dùng chung.
 *
 * Vì sao phải làm vậy: bản đầu để mỗi bài tự đăng nhập, và bài admin đầu tiên
 * qua còn các bài sau timeout ở `waitForURL`. Không phải trang hỏng — chính
 * `checkRateLimit` của app chặn việc đăng nhập liên tiếp. Đăng nhập một lần
 * vừa sửa được lỗi đó, vừa đỡ đập vào prod.
 *
 * Phiên lưu ra thư mục tạm của HỆ ĐIỀU HÀNH, không nằm trong repo: nó chứa
 * cookie admin thật.
 */
setup("đăng nhập admin trên prod (một lần)", async ({ page }) => {
  const username = process.env.ADMIN_USERNAME ?? "";
  const password = process.env.ADMIN_PASSWORD ?? "";
  expect(username, "thiếu ADMIN_USERNAME trong .env.local").not.toBe("");
  expect(password, "thiếu ADMIN_PASSWORD trong .env.local").not.toBe("");

  await page.goto("/admin/login", { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: "Tên đăng nhập" }).fill(username);
  await page.getByRole("textbox", { name: "Mật khẩu" }).fill(password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await page.waitForURL("**/admin/dashboard", { timeout: 45_000 });

  await page.context().storageState({ path: PROD_STORAGE_STATE });
});

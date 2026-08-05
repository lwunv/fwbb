import { test, expect } from "@playwright/test";
import { expectNoAppError } from "./utils";

// Trang Cài đặt ghi thẳng vào app_settings qua server action. Bài này xác nhận
// vòng ghi→đọc: đổi "Số người tối đa" rồi reload phải thấy giá trị mới (không
// phải chỉ state client). Dùng storageState admin từ auth.setup.ts.
test.describe("admin settings page", () => {
  test("đổi số người tối đa mặc định rồi reload thấy giá trị mới", async ({
    page,
  }) => {
    await page.goto("/admin/settings", { waitUntil: "domcontentloaded" });
    await expectNoAppError(page);

    const field = page.getByLabel("Số người tối đa", { exact: true });
    await expect(field).toBeVisible();

    await field.fill("20");
    await field.blur();
    await page.reload({ waitUntil: "domcontentloaded" });

    await expect(
      page.getByLabel("Số người tối đa", { exact: true }),
    ).toHaveValue("20");

    // Trả về mặc định để local.db không lệch cho các bài khác chạy sau.
    const reset = page.getByLabel("Số người tối đa", { exact: true });
    await reset.fill("8");
    await reset.blur();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByLabel("Số người tối đa", { exact: true }),
    ).toHaveValue("8");
  });
});

import { test, expect } from "@playwright/test";
import { expectNoAppError, saveSettings } from "./utils";

// Trang Cài đặt ghi vào app_settings qua server action, nhưng chỉ khi bấm Lưu
// (bản nháp, từ 22/9/2026). Bài này xác nhận vòng nháp→lưu→đọc: đổi "Số người
// tối đa", bấm Lưu, reload phải thấy giá trị mới. Dùng storageState admin từ
// auth.setup.ts.
test.describe("admin settings page", () => {
  test("đổi số người tối đa mặc định, bấm Lưu rồi reload thấy giá trị mới", async ({
    page,
  }) => {
    await page.goto("/admin/settings", { waitUntil: "domcontentloaded" });
    await expectNoAppError(page);

    const field = page.getByLabel("Số người tối đa", { exact: true });
    await expect(field).toBeVisible();

    await field.fill("20");
    await field.blur();
    // Chưa bấm Lưu thì reload phải MẤT thay đổi — đây là cả điểm của nút Lưu.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByLabel("Số người tối đa", { exact: true }),
    ).toHaveValue("8");

    await page.getByLabel("Số người tối đa", { exact: true }).fill("20");
    await saveSettings(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByLabel("Số người tối đa", { exact: true }),
    ).toHaveValue("20");

    // Trả về mặc định để local.db không lệch cho các bài khác chạy sau.
    await page.getByLabel("Số người tối đa", { exact: true }).fill("8");
    await saveSettings(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByLabel("Số người tối đa", { exact: true }),
    ).toHaveValue("8");
  });
});

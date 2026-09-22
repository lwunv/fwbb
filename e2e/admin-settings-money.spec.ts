import { test, expect, type Page } from "@playwright/test";
import { expectNoAppError, saveSettings } from "./utils";

// Section chia tiền (Task 5, giai đoạn 3): chỉ ba nhóm không phân biệt giới
// được hiện, và đổi một dòng phải ghi cả sáu nhóm (schema .strict() ở
// registry chặn patch thiếu nhóm) — round-trip qua reload là bằng chứng thật,
// không phải chỉ nhìn state client.
//
// Bộ chọn cách tính là CustomSelect (button tự vẽ, không phải <select>).
// Trình duyệt gán accessible name của nó từ <label> bao ngoài (giống input),
// nên target bằng getByRole("button", { name }) — KHÔNG getByLabel, vì
// getByLabel của Playwright chỉ khớp input/textarea/select, không khớp
// button dù DOM/AX tree có liên kết label.
function modeButton(page: Page, name: string) {
  return page.getByRole("button", { name, exact: true });
}

// Ô số tiền nằm trong CÙNG một <label> với span đơn vị "đ" phía sau — accessible
// name thật là "Số tiền: <nhóm> đ" (gộp cả caption lẫn đơn vị), nên khớp bằng
// substring (exact: false) thay vì chép lại chuỗi ghép đủ hậu tố.
function amountField(page: Page, group: string) {
  return page.getByLabel(`Số tiền: ${group}`, { exact: false });
}

function capField(page: Page, group: string) {
  return page.getByLabel(`Không trả cao hơn suất chia đều: ${group}`, {
    exact: true,
  });
}

test.describe("admin settings — money policy section", () => {
  test("chỉ hiện ba nhóm không phân biệt giới, ẩn ba nhóm nữ", async ({
    page,
  }) => {
    await page.goto("/admin/settings", { waitUntil: "domcontentloaded" });
    await expectNoAppError(page);

    // Ba nhãn "Cách tính: <nhóm>" phải hiện đúng ba, không phải sáu — nếu
    // female group nào lọt vào DOM, count này sẽ lệch.
    await expect(page.locator("span", { hasText: /^Cách tính:/ })).toHaveCount(
      3,
    );
    await expect(modeButton(page, "Cách tính: Thành viên")).toBeVisible();
    await expect(
      modeButton(page, "Cách tính: Khách của thành viên"),
    ).toBeVisible();
    await expect(modeButton(page, "Cách tính: Khách của admin")).toBeVisible();
  });

  test("đổi chính sách nhóm khách-của-admin, bấm Lưu rồi reload thấy giá trị mới", async ({
    page,
  }) => {
    await page.goto("/admin/settings", { waitUntil: "domcontentloaded" });
    await expectNoAppError(page);

    try {
      // Mặc định guestAdmin: floor 60.000, capAtEqual=false. Đổi sang fixed
      // 50.000 + bật cap. Cả ba thay đổi nằm chung một bản nháp nên chỉ cần
      // MỘT lần Lưu; `saveSettings` đợi thanh Lưu biến mất, tức mọi khoá đã
      // ghi xong dưới server trước khi reload.
      await modeButton(page, "Cách tính: Khách của admin").click();
      await page.getByRole("button", { name: "Cố định", exact: true }).click();

      const amount = amountField(page, "Khách của admin");
      await expect(amount).toBeVisible();
      await amount.fill("50000");
      await amount.blur();

      await capField(page, "Khách của admin").check();
      await saveSettings(page);

      await page.reload({ waitUntil: "domcontentloaded" });

      // Ô tiền giờ hiện kiểu Việt (MoneyInput dùng chung), nên giá trị đọc ra là
      // "50.000" chứ không phải "50000". Khẳng định luôn cả phần format:
      // vừa chứng minh đã lưu đúng, vừa chốt cách hiển thị.
      await expect(amountField(page, "Khách của admin")).toHaveValue("50.000");
      await expect(capField(page, "Khách của admin")).toBeChecked();
    } finally {
      // Trả về đúng mặc định (floor 60.000, cap=false) để không lệch cho các
      // bài khác dựa vào chính sách mặc định của guestAdmin (sàn 60K). Ép về
      // "fixed" trước để chắc chắn thấy được ô tick/số tiền bất kể try ở trên
      // dừng ở bước nào.
      await modeButton(page, "Cách tính: Khách của admin").click();
      await page.getByRole("button", { name: "Cố định", exact: true }).click();

      const cap = capField(page, "Khách của admin");
      if (await cap.isChecked()) await cap.uncheck();

      const amount = amountField(page, "Khách của admin");
      await amount.fill("60000");
      await amount.blur();

      await modeButton(page, "Cách tính: Khách của admin").click();
      await page
        .getByRole("button", { name: "Sàn tối thiểu", exact: true })
        .click();
      await saveSettings(page);

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(amountField(page, "Khách của admin")).toHaveValue("60.000");
    }
  });
});

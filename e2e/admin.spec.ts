import { test, expect } from "@playwright/test";
import { expectNoAppError } from "./utils";

// Mọi menu admin phải render (authenticated) — bắt crash render server-side mà
// unit/integration test không cover. Read-only: chỉ điều hướng + đọc.
const ADMIN_MENUS = [
  "/admin/dashboard",
  "/admin/sessions",
  "/admin/members",
  "/admin/courts",
  "/admin/shuttlecocks",
  "/admin/inventory",
  "/admin/fund",
  "/admin/fund/transactions",
  "/admin/court-rent",
  "/admin/shuttlecock-finance",
  "/admin/stats",
];

test.describe("admin menus render (authenticated, read-only)", () => {
  for (const path of ADMIN_MENUS) {
    test(`${path} renders trong admin layout`, async ({ page }) => {
      const res = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(res?.status() ?? 0, `${path} HTTP status`).toBeLessThan(500);
      await expectNoAppError(page);
      // Sidebar admin layout render được = page không vỡ.
      await expect(
        page.getByRole("heading", { name: "FWBB Admin" }),
      ).toBeVisible({ timeout: 10_000 });
    });
  }
});

test.describe("fund + inventory flows (read-only)", () => {
  test("fund roster derive từ members + chạy đối soát không lỗi", async ({
    page,
  }) => {
    await page.goto("/admin/fund");
    // Roster = members active+approved → có dòng "N thành viên".
    await expect(page.getByText(/\d+ thành viên/)).toBeVisible();
    // Có ít nhất 1 card member trong roster.
    await expect(
      page.getByText(/Quỹ đã hết|Còn nợ|Vẫn còn quỹ/).first(),
    ).toBeVisible();
    // KHÔNG còn nút "thêm vào quỹ" (addFundMember đã gỡ); vẫn còn ghi đóng quỹ.
    await expect(
      page.getByRole("button", { name: /Ghi nhận đóng quỹ/i }),
    ).toBeVisible();

    // Chạy đối soát (read-only) — không được crash, không rời trang.
    await page.getByRole("button", { name: /Chạy đối soát/i }).click();
    await page.waitForTimeout(1500);
    await expectNoAppError(page);
    await expect(page).toHaveURL(/\/admin\/fund$/);
  });

  test("inventory render stock cards + low-stock badge", async ({ page }) => {
    await page.goto("/admin/inventory");
    await expect(page.getByText("Tồn kho").first()).toBeVisible();
    // Sau reset tồn = 0 (< 12) → badge cảnh báo per-brand phải hiện.
    await expect(page.getByText(/Cảnh báo tồn kho thấp/).first()).toBeVisible();
  });
});

import { test, expect } from "@playwright/test";
import { expectNoAppError } from "./utils";

// Trang công khai / không cần đăng nhập admin. Chỉ kiểm render (no 500, no
// error boundary). Một số có thể redirect → vẫn hợp lệ, miễn không 5xx.
const PUBLIC_PAGES = [
  "/admin/login",
  "/privacy",
  "/data-deletion",
  "/history",
  "/",
];

test.describe("public pages render (no 5xx)", () => {
  for (const path of PUBLIC_PAGES) {
    test(`GET ${path}`, async ({ page }) => {
      const res = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(res?.status() ?? 0, `${path} HTTP status`).toBeLessThan(500);
      await expectNoAppError(page);
    });
  }
});

// Trang member-facing: không có session member → render trạng thái logged-out
// hoặc redirect. KHÔNG được 5xx (đây là nơi refactor /me đụng tới fund balance).
const MEMBER_PAGES = ["/me", "/my-fund", "/my-debts"];

test.describe("member pages render without session (no 5xx)", () => {
  for (const path of MEMBER_PAGES) {
    test(`GET ${path}`, async ({ page }) => {
      const res = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(res?.status() ?? 0, `${path} HTTP status`).toBeLessThan(500);
      await expectNoAppError(page);
    });
  }
});

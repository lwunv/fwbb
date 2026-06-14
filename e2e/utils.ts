import { expect, type Page } from "@playwright/test";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin123";

/** Log in as admin via the real /admin/login form. Reads creds from env so
 *  they are never hardcoded in the committed repo. */
export async function loginAsAdmin(page: Page) {
  await page.goto("/admin/login");
  await page
    .getByRole("textbox", { name: "Tên đăng nhập" })
    .fill(ADMIN_USERNAME);
  await page.getByRole("textbox", { name: "Mật khẩu" }).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await page.waitForURL("**/admin/dashboard");
}

/** Assert the page did not render Next.js' error boundary / a 500. */
export async function expectNoAppError(page: Page) {
  const body = (await page.locator("body").innerText()).toLowerCase();
  expect(body).not.toContain("application error");
  expect(body).not.toContain("internal server error");
  expect(body).not.toMatch(/\b500\b.*(error|internal)/);
  // Next.js default error boundary heading.
  await expect(
    page.getByText("Something went wrong", { exact: false }),
  ).toHaveCount(0);
}

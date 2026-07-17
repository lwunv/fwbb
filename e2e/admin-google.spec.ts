import { test, expect } from "@playwright/test";
import { createClient } from "@libsql/client";

/**
 * E2e admin Google SSO (Phase 4) trên /admin/account. Test được phần APP-render:
 * trạng thái đã-liên-kết + gỡ liên kết (unlink → DB null), và trạng thái
 * chưa-liên-kết. Luồng ĐĂNG NHẬP/LIÊN KẾT Google render bởi GIS script (external)
 * nên không drive được trong e2e → đã cover ở admin-google.integration.test.ts.
 * DB = e2e/local.db (KHÔNG đụng prod).
 */

function db() {
  return createClient({ url: "file:e2e/local.db" });
}

async function setAdminGoogle(googleId: string | null) {
  const c = db();
  // Idempotent: đảm bảo cột + index tồn tại trên local.db (migration 0021).
  try {
    await c.execute("ALTER TABLE admins ADD google_id text");
  } catch {
    /* đã có */
  }
  try {
    await c.execute(
      "CREATE UNIQUE INDEX admins_google_id_unique ON admins (google_id)",
    );
  } catch {
    /* đã có */
  }
  await c.execute({
    sql: "UPDATE admins SET google_id = ? WHERE username = 'admin'",
    args: [googleId],
  });
  c.close();
}

async function getAdminGoogle(): Promise<string | null> {
  const c = db();
  const r = await c.execute(
    "SELECT google_id FROM admins WHERE username = 'admin'",
  );
  c.close();
  return (r.rows[0]?.google_id as string | null) ?? null;
}

test.describe("admin Google SSO — /admin/account", () => {
  test("đã liên kết → hiện trạng thái + gỡ liên kết (unlink → DB null)", async ({
    page,
  }) => {
    await setAdminGoogle("e2e-google-sub-1");
    await page.goto("/admin/account", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Đã liên kết Google")).toBeVisible();

    await page.getByRole("button", { name: "Gỡ liên kết Google" }).click();

    await expect
      .poll(getAdminGoogle, { timeout: 10_000, intervals: [300, 500, 800] })
      .toBeNull();
  });

  test("chưa liên kết → hiện hướng dẫn liên kết Google", async ({ page }) => {
    await setAdminGoogle(null);
    await page.goto("/admin/account", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Chưa liên kết")).toBeVisible();
  });
});

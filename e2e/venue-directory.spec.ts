import { test, expect } from "@playwright/test";
import { createClient } from "@libsql/client";

// Trang /san công khai: chạy như khách chưa đăng nhập.
test.use({ storageState: { cookies: [], origins: [] } });

const HERE = { latitude: 21.03, longitude: 105.85 };
const PREFIX = "E2E Venue ";

/** Điểm cách HERE `km` về phía bắc. */
const north = (km: number) => HERE.latitude + (km * 1000) / 111_320;

test.beforeAll(async () => {
  const c = createClient({ url: "file:e2e/local.db" });
  // Fixture và server Next mở CÙNG file → chờ lock nhả thay vì SQLITE_BUSY.
  await c.execute("PRAGMA busy_timeout = 5000");
  await c.execute({
    sql: "DELETE FROM venues WHERE name LIKE ?",
    args: [`${PREFIX}%`],
  });
  const rows: [string, number, string][] = [
    [`${PREFIX}Gần`, north(1), "approved"],
    [`${PREFIX}Xa`, north(3), "approved"],
    [`${PREFIX}Chờ duyệt`, north(0.5), "pending"],
  ];
  for (const [name, lat, status] of rows) {
    await c.execute({
      sql: "INSERT INTO venues (name, lat, lng, status) VALUES (?, ?, ?, ?)",
      args: [name, lat, HERE.longitude, status],
    });
  }
  c.close();
});

test.afterAll(async () => {
  const c = createClient({ url: "file:e2e/local.db" });
  await c.execute("PRAGMA busy_timeout = 5000");
  await c.execute({
    sql: "DELETE FROM venues WHERE name LIKE ?",
    args: [`${PREFIX}%`],
  });
  c.close();
});

test("có GPS: thấy sân đã duyệt theo thứ tự khoảng cách, không thấy sân chờ duyệt", async ({
  browser,
}) => {
  const ctx = await browser.newContext({
    geolocation: HERE,
    permissions: ["geolocation"],
    storageState: { cookies: [], origins: [] },
  });
  const page = await ctx.newPage();
  await page.goto("/san");

  const names = page.getByRole("link", { name: new RegExp(`^${PREFIX}`) });
  await expect(names.first()).toBeVisible({ timeout: 15_000 });
  await expect(names).toHaveText([`${PREFIX}Gần`, `${PREFIX}Xa`]);
  await expect(page.getByText(`${PREFIX}Chờ duyệt`)).toHaveCount(0);

  const directions = page.getByRole("link", { name: /chỉ đường/i }).first();
  await expect(directions).toHaveAttribute(
    "href",
    new RegExp(`destination=${north(1).toString().slice(0, 6)}`),
  );
  await ctx.close();
});

test("từ chối GPS: hiện ô nhập địa chỉ, không quay mãi", async ({
  browser,
}) => {
  const ctx = await browser.newContext({
    permissions: [],
    storageState: { cookies: [], origins: [] },
  });
  const page = await ctx.newPage();
  await page.goto("/san");
  await expect(
    page.getByRole("textbox", { name: /Cầu Giấy/ }).first(),
  ).toBeVisible({ timeout: 15_000 });
  await ctx.close();
});

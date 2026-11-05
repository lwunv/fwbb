import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@libsql/client";

// Trang /san công khai: chạy như khách chưa đăng nhập.
test.use({ storageState: { cookies: [], origins: [] } });

// `listVenuesNear` cache theo ô lưới 0,01 độ và còn sống 60 giây (kể cả stale
// trên đĩa giữa các lần chạy). Mỗi lần chạy dùng một ô riêng để không đọc nhầm
// kết quả cũ, và để không dính ô Hà Nội của venue-directory.spec.ts.
const cellOffset = (Math.floor(Date.now() / 1000) % 500) * 0.01;
const HERE = { latitude: 9 + cellOffset, longitude: 105.5 };
const PREFIX = "E2E MapVenue ";
const NEAR = `${PREFIX}Gần`;
const FAR = `${PREFIX}Xa`;

/** Điểm cách HERE `km` về phía bắc. */
const north = (km: number) => HERE.latitude + (km * 1000) / 111_320;

async function cleanup() {
  const c = createClient({ url: "file:e2e/local.db" });
  // Fixture và server Next mở CÙNG file → chờ lock nhả thay vì SQLITE_BUSY.
  await c.execute("PRAGMA busy_timeout = 5000");
  await c.execute({
    sql: "DELETE FROM venues WHERE name LIKE ?",
    args: [`${PREFIX}%`],
  });
  c.close();
}

test.beforeAll(async () => {
  await cleanup();
  const c = createClient({ url: "file:e2e/local.db" });
  await c.execute("PRAGMA busy_timeout = 5000");
  for (const [name, lat] of [
    [NEAR, north(1)],
    [FAR, north(3)],
  ] as const) {
    await c.execute({
      sql: "INSERT INTO venues (name, lat, lng, status) VALUES (?, ?, ?, 'approved')",
      args: [name, lat, HERE.longitude],
    });
  }
  c.close();
});

test.afterAll(cleanup);

/**
 * Trang mới với GPS giả và style bản đồ rỗng (không phụ thuộc mạng). Trả về
 * danh sách URL đã gọi tới openfreemap để bài kiểm đếm được.
 */
async function openDirectory(
  browser: import("@playwright/test").Browser,
  path: string,
) {
  const ctx = await browser.newContext({
    geolocation: HERE,
    permissions: ["geolocation"],
    viewport: { width: 390, height: 844 },
    storageState: { cookies: [], origins: [] },
  });
  const page: Page = await ctx.newPage();
  const mapRequests: string[] = [];
  await page.route("**/tiles.openfreemap.org/**", async (route) => {
    mapRequests.push(route.request().url());
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ version: 8, sources: {}, layers: [] }),
    });
  });
  await page.goto(path);
  return { ctx, page, mapRequests };
}

test("switching to map shows a marker per seeded venue at 390px", async ({
  browser,
}) => {
  const { ctx, page } = await openDirectory(browser, "/san");
  await expect(page.getByRole("link", { name: NEAR })).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole("button", { name: "Bản đồ", exact: true }).click();
  await expect(page).toHaveURL(/view=map/);

  // Ghim là nút HTML (aria-label = tên sân), không cần đọc canvas WebGL.
  await expect(page.getByRole("button", { name: NEAR })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("button", { name: FAR })).toBeVisible();
  await expect(
    page.getByRole("button", { name: new RegExp(`^${PREFIX}`) }),
  ).toHaveCount(2);

  // Khung bản đồ phải có chiều cao thật. Bản build production từng để
  // `.maplibregl-map { position: relative }` thắng `absolute inset-0` nên khung
  // cao 0: ghim vẫn "visible" nhưng bị cắt và không bấm được.
  const box = await page.locator(".maplibregl-map").boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(200);

  // Không tràn ngang ở 390px.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await ctx.close();
});

test("tapping a marker opens the venue card sheet with a details link", async ({
  browser,
}) => {
  const { ctx, page } = await openDirectory(browser, "/san?view=map");
  const pin = page.getByRole("button", { name: NEAR });
  await expect(pin).toBeVisible({ timeout: 20_000 });
  await pin.click();

  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  const details = sheet.getByRole("link", { name: NEAR });
  await expect(details).toHaveAttribute("href", /^\/san\/\d+$/);
  await details.click();
  await expect(page).toHaveURL(/\/san\/\d+$/);
  await ctx.close();
});

test("list view still works and does not request the map style", async ({
  browser,
}) => {
  const { ctx, page, mapRequests } = await openDirectory(browser, "/san");
  const names = page.getByRole("link", { name: new RegExp(`^${PREFIX}`) });
  await expect(names).toHaveText([NEAR, FAR], { timeout: 15_000 });
  // Cho bản đồ (nếu lỡ nạp) có thời gian gọi mạng trước khi đếm.
  await page.waitForTimeout(1500);
  expect(mapRequests).toHaveLength(0);
  await ctx.close();
});

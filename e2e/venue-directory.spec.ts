import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { createClient } from "@libsql/client";

// Trang /venues công khai: chạy như khách chưa đăng nhập.
test.use({ storageState: { cookies: [], origins: [] } });

// `listVenuesNear` cache theo ô lưới 0,01 độ và còn sống 60 giây (kể cả stale
// trên đĩa giữa các lần chạy), nên dữ liệu của lần chạy khác ở cùng ô sẽ lọt
// vào kết quả. Mỗi lần chạy dùng một ô riêng, lệch 250 ô so với venue-map.spec.ts
// (cùng công thức, cùng thời điểm nạp) để hai file không đụng nhau.
const cellOffset = ((Math.floor(Date.now() / 1000) + 250) % 500) * 0.01;
const HERE = { latitude: 9 + cellOffset, longitude: 105.85 };
const PREFIX = "E2E Venue ";
const PREFIX_RE = new RegExp(`^${PREFIX}`);

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
  // Giờ mở: Gần mở cả ngày, Xa là chuỗi không hiểu được ("Chưa rõ giờ").
  const rows: [string, number, string, string | null][] = [
    [`${PREFIX}Gần`, north(1), "approved", "00:00-24:00"],
    [`${PREFIX}Xa`, north(3), "approved", "abc"],
    [`${PREFIX}Chờ duyệt`, north(0.5), "pending", null],
  ];
  for (const [name, lat, status, hours] of rows) {
    await c.execute({
      sql: "INSERT INTO venues (name, lat, lng, status, open_hours) VALUES (?, ?, ?, ?, ?)",
      args: [name, lat, HERE.longitude, status, hours],
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

const MOBILE = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  storageState: { cookies: [], origins: [] },
};

/** Trang mới ở 390px có chạm, GPS giả (HERE) hoặc không GPS, style bản đồ rỗng. */
async function openMobile(
  browser: Browser,
  path: string,
  opts: { gps?: boolean; noWebGL?: boolean } = {},
): Promise<{ ctx: BrowserContext; page: Page; mapRequests: string[] }> {
  const gps = opts.gps ?? true;
  const ctx = await browser.newContext({
    ...MOBILE,
    ...(gps
      ? { geolocation: HERE, permissions: ["geolocation"] }
      : { permissions: [] }),
  });
  const page = await ctx.newPage();
  const mapRequests: string[] = [];
  await page.route("**/tiles.openfreemap.org/**", async (route) => {
    mapRequests.push(route.request().url());
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ version: 8, sources: {}, layers: [] }),
    });
  });
  if (opts.noWebGL) {
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...args: unknown[]
      ) {
        if (type === "webgl2" || type === "webgl") return null;
        return (orig as (...a: unknown[]) => unknown).call(this, type, ...args);
      } as typeof orig;
    });
  }
  await page.goto(path);
  return { ctx, page, mapRequests };
}

/** Kéo một ngón bằng CDP, có nghỉ cuối để vận tốc lúc thả gần 0 (không bị tính là vuốt nhanh). */
async function touchDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const cdp = await page.context().newCDPSession(page);
  const send = (
    type: "touchStart" | "touchMove" | "touchEnd",
    p?: { x: number; y: number },
  ) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: p ? [{ x: p.x, y: p.y }] : [],
    });
  await send("touchStart", from);
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await send("touchMove", {
      x: from.x + ((to.x - from.x) * i) / steps,
      y: from.y + ((to.y - from.y) * i) / steps,
    });
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(250);
  await send("touchEnd");
  await cdp.detach();
}

const panelY = async (page: Page) =>
  (await page.getByTestId("venue-sheet-panel").boundingBox())!.y;

async function handleCenter(page: Page) {
  const b = (await page.getByTestId("venue-sheet-handle").boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + 12 };
}

/** Tiêu đề ngăn là nút đổi nấc: thấp, giữa, cao, rồi về thấp. */
const sheetTitle = (page: Page) =>
  page.getByTestId("venue-sheet-handle").getByRole("button");

/** Tên (aria-label) của các thẻ sân thuộc bộ seed, theo thứ tự trong danh sách. */
const cardNames = (page: Page) =>
  cards(page).evaluateAll((els) =>
    els.map((e) => e.getAttribute("aria-label")),
  );

/** Thẻ sân của bộ seed trong danh sách của ngăn (DB e2e có thể có sân khác). */
const cards = (page: Page) =>
  page.getByTestId("venue-sheet-list").getByRole("button", { name: PREFIX_RE });

async function waitSheetReady(page: Page) {
  await expect(sheetTitle(page)).toContainText(/sân quanh đây/, {
    timeout: 20_000,
  });
}

async function openSheetMid(page: Page) {
  await waitSheetReady(page);
  await sheetTitle(page).click();
  await expect(sheetTitle(page)).toHaveAttribute("aria-expanded", "true");
}

test("có GPS: thấy sân đã duyệt theo thứ tự khoảng cách, không thấy sân chờ duyệt", async ({
  browser,
}) => {
  const { ctx, page } = await openMobile(browser, "/venues");
  await openSheetMid(page);

  await expect(cards(page).first()).toBeVisible({ timeout: 15_000 });
  // Thẻ chỉ là nút phủ có aria-label (chữ nằm ở phần tử anh em), nên đọc tên.
  await expect
    .poll(() => cardNames(page))
    .toEqual([`${PREFIX}Gần`, `${PREFIX}Xa`]);
  await expect(page.getByText(`${PREFIX}Chờ duyệt`)).toHaveCount(0);

  const directions = page
    .getByTestId("venue-sheet-list")
    .getByRole("link", { name: /chỉ đường/i })
    .first();
  await expect(directions).toHaveAttribute(
    "href",
    new RegExp(`destination=${north(1).toString().slice(0, 6)}`),
  );
  await ctx.close();
});

test("từ chối GPS: bản đồ hiện ngay quanh Hà Nội và ô tìm luôn có", async ({
  browser,
}) => {
  const { ctx, page } = await openMobile(browser, "/venues", { gps: false });
  await expect(page.getByRole("combobox")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/quanh Hà Nội/)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator(".maplibregl-map")).toBeVisible();
  await waitSheetReady(page);
  await ctx.close();
});

test("bản đồ hiện trong màn hình đầu tiên, không phải cuộn", async ({
  browser,
}) => {
  const { ctx, page } = await openMobile(browser, "/venues");
  await expect(page.locator(".maplibregl-map")).toBeVisible({
    timeout: 20_000,
  });
  const m = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    inner: window.innerHeight,
  }));
  expect(m.scrollHeight).toBeLessThanOrEqual(m.inner + 1);
  const box = (await page.locator(".maplibregl-map").boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(m.inner + 1);
  await ctx.close();
});

test("bấm thẻ sân mở thẻ xem nhanh, URL có ?venue=, nút Back đóng nó", async ({
  browser,
}) => {
  const { ctx, page } = await openMobile(browser, "/venues");
  await openSheetMid(page);
  await cards(page).first().click();
  await expect(page).toHaveURL(/[?&]venue=\d+/);
  const details = page.getByRole("link", { name: "Xem chi tiết" });
  await expect(details).toBeVisible();

  await page.goBack();
  await expect(page).not.toHaveURL(/venue=/);
  await expect(details).toHaveCount(0);
  await ctx.close();
});

test("chip Đang mở cửa chỉ còn sân mở 24 giờ", async ({ browser }) => {
  const { ctx, page } = await openMobile(browser, "/venues");
  await openSheetMid(page);
  await expect(cards(page)).toHaveCount(2, { timeout: 15_000 });

  await page.getByRole("button", { name: "Đang mở cửa" }).click();
  await expect.poll(() => cardNames(page)).toEqual([`${PREFIX}Gần`]);
  await ctx.close();
});

test("kéo tay cầm từ thấp lên giữa bằng chạm", async ({ browser }) => {
  const { ctx, page } = await openMobile(browser, "/venues");
  await waitSheetReady(page);
  await expect(sheetTitle(page)).toHaveAttribute("aria-expanded", "false");
  const low = await panelY(page);

  const from = await handleCenter(page);
  await touchDrag(page, from, { x: from.x, y: from.y - 280 });

  await expect(sheetTitle(page)).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => panelY(page)).toBeLessThan(low - 150);
  // Nấc giữa, chưa phải nấc cao (nấc cao dừng ngay dưới ô tìm, rất gần đỉnh).
  expect(await panelY(page)).toBeGreaterThan(250);
  await ctx.close();
});

test("kéo tay cầm 30px rồi thả thì ngăn về đúng nấc cũ", async ({
  browser,
}) => {
  const { ctx, page } = await openMobile(browser, "/venues");
  await openSheetMid(page);
  // Chờ lò xo của lần bấm tiêu đề dừng hẳn rồi mới đo.
  await expect
    .poll(async () => {
      const a = await panelY(page);
      await page.waitForTimeout(250);
      return Math.abs(a - (await panelY(page)));
    })
    .toBeLessThan(1);
  const before = await panelY(page);

  const from = await handleCenter(page);
  await touchDrag(page, from, { x: from.x, y: from.y + 30 });

  await expect
    .poll(async () => Math.abs((await panelY(page)) - before))
    .toBeLessThanOrEqual(2);
  await ctx.close();
});

test("một ngón kéo trên bản đồ khi ngăn ở thấp làm hiện 'Tìm ở khu vực này'", async ({
  browser,
}) => {
  const { ctx, page } = await openMobile(browser, "/venues");
  await expect(page.getByRole("button", { name: PREFIX_RE })).not.toHaveCount(
    0,
    { timeout: 20_000 },
  );
  await expect(
    page.getByRole("button", { name: "Tìm ở khu vực này" }),
  ).toHaveCount(0);
  await touchDrag(page, { x: 200, y: 420 }, { x: 90, y: 300 });
  await expect(
    page.getByRole("button", { name: "Tìm ở khu vực này" }),
  ).toBeVisible({ timeout: 10_000 });
  await ctx.close();
});

test("gõ tên sân rồi chạm gợi ý đầu tiên mở thẻ xem nhanh (điện thoại)", async ({
  browser,
}) => {
  const { ctx, page } = await openMobile(browser, "/venues");
  await waitSheetReady(page);
  await page.getByRole("combobox").fill(`${PREFIX}G`);
  await page.getByRole("option").first().tap();
  await expect(page).toHaveURL(/[?&]venue=\d+/);
  await expect(page.getByRole("link", { name: "Xem chi tiết" })).toBeVisible();
  await ctx.close();
});

test("gõ tên sân rồi bấm gợi ý đầu tiên mở thẻ xem nhanh (máy tính)", async ({
  browser,
}) => {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    geolocation: HERE,
    permissions: ["geolocation"],
    storageState: { cookies: [], origins: [] },
  });
  const page = await ctx.newPage();
  await page.route("**/tiles.openfreemap.org/**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ version: 8, sources: {}, layers: [] }),
    }),
  );
  await page.goto("/venues");
  await expect(page.getByTestId("venues-column")).toContainText(PREFIX, {
    timeout: 20_000,
  });
  await page.getByRole("combobox").fill(`${PREFIX}G`);
  await page.getByRole("option").first().click();
  await expect(page).toHaveURL(/[?&]venue=\d+/);
  await expect(page.getByRole("link", { name: "Xem chi tiết" })).toBeVisible();
  await ctx.close();
});

test("link /venues?view=list cũ vẫn mở được", async ({ browser }) => {
  const { ctx, page } = await openMobile(browser, "/venues?view=list");
  await waitSheetReady(page);
  await ctx.close();
});

test("legacy /san URLs redirect permanently to /venues, keeping the query", async ({
  request,
}) => {
  for (const [from, to] of [
    ["/san", "/venues"],
    ["/san?r=10", "/venues?r=10"],
    ["/san/de-xuat", "/venues/suggest"],
    ["/san/12", "/venues/12"],
  ]) {
    const res = await request.get(from, { maxRedirects: 0 });
    expect(res.status(), from).toBe(308);
    expect(res.headers().location, from).toBe(to);
  }
});

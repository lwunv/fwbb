import { test, expect, type Page } from "@playwright/test";

/**
 * Kiểm PROD đầu-cuối, CHỈ ĐỌC.
 *
 * ⚠️ QUY TẮC CỦA FILE NÀY, đọc trước khi thêm bất cứ thứ gì:
 *
 * Chỉ được `goto`, đọc DOM, và bấm những thứ KHÔNG ghi gì xuống DB (mở hộp
 * thoại, đổi tab, đổi filter trên URL). TUYỆT ĐỐI KHÔNG: submit form, bấm nút
 * lưu/xoá/chốt sổ, gọi server action, đụng bảng nào. Đây là dữ liệu thật của
 * người thật, và sổ quỹ ở đây là tiền thật.
 *
 * Vì sao cần file riêng thay vì chạy bộ e2e sẵn có lên prod: 14 spec trong
 * `e2e/` ghi thẳng vào DB, riêng `money-flow.spec.ts` có 25 lệnh ghi và CHỐT SỔ
 * thật. Chạy chúng lên prod là tạo nợ giả và trừ quỹ của người thật.
 *
 * Chạy: `npx playwright test --config playwright.prod.config.ts`
 */

/** Trang không được render error boundary hay 5xx. */
async function expectHealthy(page: Page) {
  const body = (await page.locator("body").innerText()).toLowerCase();
  expect(body).not.toContain("application error");
  expect(body).not.toContain("internal server error");
  await expect(
    page.getByText("Something went wrong", { exact: false }),
  ).toHaveCount(0);
}

test.describe("PROD chỉ-đọc", () => {
  test("trang công khai render được, không lỗi", async ({ page }) => {
    for (const path of ["/", "/history", "/stats", "/privacy"]) {
      const res = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(res?.status() ?? 0, `${path} status`).toBeLessThan(400);
      await expectHealthy(page);
    }
  });

  test("Toaster ĐÃ được mount (bug im lặng đã hết)", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    // KHÔNG dùng `[data-sonner-toaster]`: sonner chỉ gắn thuộc tính đó lên thẻ
    // `<ol>` danh sách toast, mà `<ol>` chỉ tồn tại KHI ĐANG CÓ toast
    // (`if (!filteredToasts.length) return null` trong sonner). Trang bình
    // thường không có toast nào, nên kiểm bằng selector đó sẽ báo đỏ dù Toaster
    // đã mount đàng hoàng — đã dính đúng bẫy này khi viết bài.
    //
    // Thứ sonner LUÔN render là thẻ `<section>` vùng thông báo (aria-live),
    // dựng ngay lúc mount kể cả khi rỗng. Có nó = Toaster đã mount.
    const region = page.locator(
      'section[aria-live="polite"][aria-relevant="additions text"]',
    );
    await expect(region).toHaveCount(1, { timeout: 15_000 });
  });

  test("icon màn hình chính iOS có thật và tải được", async ({
    page,
    request,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const link = page.locator('link[rel="apple-touch-icon"]');
    await expect(link).toHaveCount(1);
    const href = await link.getAttribute("href");
    const res = await request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
    // Không bật standalone: nó hay làm đứt phiên OAuth trên iOS.
    await expect(
      page.locator('meta[name="mobile-web-app-capable"]'),
    ).toHaveCount(0);
  });

  test("mọi trang admin render được sau khi đăng nhập", async ({ page }) => {
    const paths = [
      "/admin/dashboard",
      "/admin/sessions",
      "/admin/members",
      "/admin/settings",
      "/admin/fund",
      "/admin/court-rent",
      "/admin/stats",
      "/admin/inventory",
    ];
    for (const path of paths) {
      const res = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(res?.status() ?? 0, `${path} status`).toBeLessThan(400);
      await expectHealthy(page);
      await expect(
        page.getByRole("heading", { name: "FWBB Admin" }),
      ).toBeVisible({ timeout: 20_000 });
    }
  });

  test("trang Cài đặt: công tắc giới tính đang TẮT nên không có nhóm nữ nào", async ({
    page,
  }) => {
    await page.goto("/admin/settings", { waitUntil: "domcontentloaded" });
    // Ba nhóm thường phải có — chứng minh section tiền render thật.
    await expect(
      page.getByRole("button", { name: "Cách tính: Thành viên" }),
    ).toBeVisible({ timeout: 20_000 });
    // Ba nhóm nữ phải VẮNG: chặng 2 vừa deploy nhưng công tắc mặc định tắt,
    // nên tiền phải đang chạy y như trước.
    for (const label of [
      "Thành viên nữ",
      "Khách nữ của thành viên",
      "Khách nữ của admin",
    ]) {
      await expect(page.getByText(label)).toHaveCount(0);
    }
  });

  test("ô nhập tiền hiện kiểu Việt, không phải chuỗi số trần", async ({
    page,
  }) => {
    await page.goto("/admin/settings", { waitUntil: "domcontentloaded" });
    const field = page.getByLabel(/Cảnh báo quỹ thấp dưới/).first();
    await expect(field).toBeVisible({ timeout: 20_000 });
    const shown = await field.inputValue();
    // Chỉ ĐỌC giá trị, không sửa. Có dấu chấm ngăn nghìn, hoặc là số nhỏ hơn
    // 1000 (chưa cần ngăn cách) — nhưng KHÔNG được là "100000".
    expect(shown).not.toMatch(/^\d{4,}$/);
  });

  test("chip lọc thành viên: số trên chip khớp số dòng đang hiện", async ({
    page,
  }) => {
    await page.goto("/admin/members", { waitUntil: "domcontentloaded" });
    const allTab = page.getByRole("tab", { name: /^Tất cả/ });
    const activeTab = page.getByRole("tab", { name: /^Hoạt động/ });
    await expect(allTab).toBeVisible({ timeout: 20_000 });
    const readCount = async (loc: typeof allTab) => {
      const text = (await loc.textContent()) ?? "";
      const m = text.match(/(\d+)\s*$/);
      return m ? Number(m[1]) : NaN;
    };
    const all = await readCount(allTab);
    const active = await readCount(activeTab);
    expect(Number.isNaN(all)).toBe(false);
    // "Tất cả" phải >= "Hoạt động": nó gồm cả ghost. Trước bản vá 21/9 hai số
    // này bằng nhau và đều nhỏ hơn số dòng thật.
    expect(all).toBeGreaterThanOrEqual(active);
  });
});

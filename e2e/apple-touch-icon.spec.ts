import { test, expect } from "@playwright/test";

/**
 * Lỗi user báo 21/9: thêm web ra màn hình chính trên iPhone thì không có icon,
 * chỉ ra ô chữ "F" iOS tự chế. Android vẫn có icon.
 *
 * Nguyên nhân: app chỉ có `src/app/icon.svg` và không có manifest. Chrome trên
 * Android đọc được favicon SVG nên vẫn dựng được icon, còn iOS Safari KHÔNG
 * nhận SVG cho icon màn hình chính — nó chỉ đọc `<link rel="apple-touch-icon">`
 * trỏ tới ảnh raster.
 *
 * Test canh đúng cái thiếu: thẻ phải tồn tại, và file nó trỏ tới phải tải được
 * thật, là PNG thật. Khai thẻ mà file 404 thì iOS vẫn ra ô chữ như cũ.
 */

test.describe("icon cho màn hình chính iOS", () => {
  test("có apple-touch-icon và file tải được, đúng định dạng PNG", async ({
    page,
    request,
  }) => {
    await page.goto("/");

    const link = page.locator('link[rel="apple-touch-icon"]');
    await expect(link).toHaveCount(1);

    const href = await link.getAttribute("href");
    expect(href, "apple-touch-icon phải có href").toBeTruthy();

    const res = await request.get(href!);
    expect(res.status(), `${href} phải tải được`).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");

    // Tám byte đầu của mọi file PNG hợp lệ. Chặn trường hợp route trả về HTML
    // lỗi kèm status 200, lúc đó iOS vẫn không có icon mà test lại xanh.
    const body = await res.body();
    expect([...body.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  test("nhãn dưới icon là tên ngắn, không phải tiêu đề bị cắt cụt", async ({
    page,
  }) => {
    await page.goto("/");
    const meta = page.locator('meta[name="apple-mobile-web-app-title"]');
    await expect(meta).toHaveCount(1);
    await expect(meta).toHaveAttribute("content", "FWBB");
  });

  test("KHÔNG bật chế độ standalone", async ({ page }) => {
    await page.goto("/");
    // Standalone làm app mở không có thanh Safari, và hay làm đứt phiên đăng
    // nhập Facebook/Google trên iOS. Sửa icon thì không được kéo theo thay đổi
    // đó — nếu sau này ai bật, phải là quyết định có chủ ý và test lại OAuth.
    await expect(
      page.locator('meta[name="mobile-web-app-capable"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('meta[name="apple-mobile-web-app-capable"]'),
    ).toHaveCount(0);
  });
});

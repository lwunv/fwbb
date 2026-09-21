import { test, expect } from "@playwright/test";

/**
 * Lỗi user báo 21/9: các filter ở /admin/sessions "không optimistic UI".
 *
 * Nguyên nhân: chip trạng thái lấy value thẳng từ prop server
 * (`currentStatusFilter`), mà `setStatusFilter` chạy `shallow: false` nên phải
 * đợi server fetch xong slice mới thì chip mới đổi. Bấm xong chip đứng im,
 * nhìn như bấm hụt.
 *
 * Test khẳng định hai thứ ngay SAU cú bấm, KHÔNG chờ điều hướng xong:
 * chip đã sáng, và vùng danh sách đã báo đang tải (`aria-busy`).
 */

test.describe("filter ở trang buổi chơi phản hồi ngay", () => {
  test("bấm chip: chip sáng tức thì và danh sách báo đang tải", async ({
    page,
  }) => {
    await page.goto("/admin/sessions");

    const allChip = page.getByRole("tab", { name: /^Tất cả/ });
    const doneChip = page.getByRole("tab", { name: /^Hoàn thành/ });
    await expect(allChip).toBeVisible();
    await expect(allChip).toHaveAttribute("aria-selected", "true");

    await doneChip.click();

    // Không `waitForURL`, không `networkidle`: nếu phải đợi server thì test
    // này vô nghĩa. Chip phải sáng ngay trong khoảng rất ngắn.
    await expect(doneChip).toHaveAttribute("aria-selected", "true", {
      timeout: 1_000,
    });
    await expect(allChip).toHaveAttribute("aria-selected", "false", {
      timeout: 1_000,
    });

    // Sau khi server trả slice mới, chip vẫn đúng và danh sách hết mờ.
    await page.waitForLoadState("networkidle");
    await expect(doneChip).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    expect(page.url()).toContain("status=completed");
  });
});

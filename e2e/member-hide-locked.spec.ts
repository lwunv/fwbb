import { test, expect } from "@playwright/test";
import { createClient } from "@libsql/client";

/**
 * Yêu cầu user 21/9: người đã rời nhóm không được nằm lẫn trong danh sách
 * thành viên nữa. Xóa cứng không phải lối ra (bị chặn khi còn nợ hoặc còn giao
 * dịch quỹ, để giữ dấu vết tài chính), nên lối ra là "Vô hiệu hóa": bấm xong
 * người đó biến khỏi mọi tab, chỉ còn tìm thấy ở tab "Đã khóa".
 *
 * Test tự dọn: khóa xong thì mở lại, nên fixture e2e/local.db không đổi.
 */

/**
 * Một member đang hoạt động, tên DUY NHẤT, và ĐÃ TỪNG ĐI CHƠI.
 *
 * Hai điều kiện sau không phải cho đẹp, mỗi cái chặn một cách test đo nhầm:
 *
 * - **Tên duy nhất:** tên trùng thì member lọt vào khối "gộp thành viên trùng"
 *   ở đầu trang, mà khối đó không ẩn theo bộ lọc. Locator theo tên sẽ bắt
 *   trúng khối kia chứ không phải hàng trong danh sách.
 * - **Đã từng đi chơi:** member chưa từng chơi và không nằm trong roster quỹ
 *   bị coi là "ghost", và ghost vốn đã bị ẩn khỏi MỌI tab cụ thể (kể cả "Đã
 *   khóa"). Khóa một member như vậy làm họ biến mất khỏi cả tab "Đã khóa", nên
 *   không kiểm được điều ta muốn kiểm. Ai đã từng chơi thì không bao giờ là
 *   ghost, kể cả sau khi bị khóa và rớt khỏi roster.
 */
async function pickActiveMember() {
  const c = createClient({ url: "file:e2e/local.db" });
  try {
    const r = await c.execute(`
      SELECT m.id AS id, m.name AS name
      FROM members m
      WHERE m.is_active = 1
        AND m.approval_status = 'approved'
        AND EXISTS (
          SELECT 1 FROM session_attendees a
          WHERE a.member_id = m.id AND a.attends_play = 1
        )
        AND (
          SELECT count(*) FROM members m2
          WHERE lower(trim(m2.name)) = lower(trim(m.name))
        ) = 1
      ORDER BY m.id
      LIMIT 1
    `);
    const row = r.rows[0];
    if (!row) throw new Error("fixture thiếu member hoạt động đã từng đi chơi");
    return { id: Number(row.id), name: String(row.name) };
  } finally {
    c.close();
  }
}

test("vô hiệu hóa thành viên: biến khỏi danh sách, chỉ còn ở tab Đã khóa", async ({
  page,
}) => {
  const member = await pickActiveMember();
  const search = page.getByPlaceholder("Tìm theo tên, biệt danh hoặc SĐT...");
  const row = () => page.getByText(member.name, { exact: true }).first();

  // Chip lọc là TabSegment → role="tab", không phải button.
  const lockedTab = page.getByRole("tab", { name: /^Đã khóa/ });

  await page.goto("/admin/members");
  await search.fill(member.name);
  await expect(row()).toBeVisible();

  try {
    // Khóa. Hàng phải biến mất NGAY (optimistic), không đợi server.
    await page.getByRole("button", { name: "Khóa" }).first().click();
    await expect(row()).toHaveCount(0, { timeout: 5_000 });

    // Vẫn tra được ở tab "Đã khóa" — khóa nhầm thì gỡ được, không phải mở DB.
    await lockedTab.click();
    await expect(row()).toBeVisible({ timeout: 10_000 });
  } finally {
    // Dọn: mở khóa lại để fixture về nguyên trạng cho lần chạy sau. Chạy kể cả
    // khi phần trên đã hỏng, nếu không thì spec sau chạy trên fixture lệch.
    await page.goto("/admin/members");
    await lockedTab.click();
    await search.fill(member.name);
    const unlock = page.getByRole("button", { name: "Mở" }).first();
    if (await unlock.isVisible().catch(() => false)) {
      await unlock.click();
      // Đợi request ghi xong hẳn rồi mới rời trang, tránh cắt giữa chừng làm
      // fixture kẹt ở trạng thái khóa cho spec sau.
      await page.waitForLoadState("networkidle");
    }
  }
});

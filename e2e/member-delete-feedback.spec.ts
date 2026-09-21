import { test, expect } from "@playwright/test";
import { createClient } from "@libsql/client";

/**
 * Bug thật gặp trên prod: admin bấm xóa thành viên, hàng biến mất rồi hiện lại
 * mà KHÔNG có một dòng báo nào, nên nhìn như chức năng hỏng.
 *
 * Nguyên nhân gốc: `<Toaster />` của sonner chưa từng được mount ở bất kỳ
 * layout nào (`src/components/ui/sonner.tsx` có export nhưng không file nào
 * import). 18 file gọi `toast.*` và không cái nào có chỗ để render. Riêng
 * đường xóa thành viên: `deleteMember` chặn đúng khi member còn nợ hoặc còn
 * giao dịch quỹ (xóa cứng là phá dấu vết tài chính), `fireAction` rollback
 * đúng, nhưng `toast.error` rơi vào hư không nên admin không biết vì sao.
 *
 * Test này khẳng định phần NGƯỜI DÙNG THẤY: chặn thì phải nói lý do.
 */

/** Member đầu tiên trong DB e2e còn khoản nợ — chắc chắn bị `deleteMember` chặn. */
async function pickMemberBlockedByMoney() {
  // Fixture và server Next mở CÙNG file e2e/local.db. Chỉ ĐỌC ở đây nên không
  // tranh khóa ghi với server.
  const c = createClient({ url: "file:e2e/local.db" });
  try {
    const r = await c.execute(`
      SELECT m.id AS id, m.name AS name
      FROM members m
      WHERE m.is_active = 1
        AND EXISTS (SELECT 1 FROM session_debts d WHERE d.member_id = m.id)
      ORDER BY m.id
      LIMIT 1
    `);
    const row = r.rows[0];
    if (!row) throw new Error("fixture e2e/local.db thiếu member còn nợ");
    return { id: Number(row.id), name: String(row.name) };
  } finally {
    c.close();
  }
}

test("xóa thành viên còn dữ liệu tiền: hiện rõ lý do, không im lặng", async ({
  page,
}) => {
  const member = await pickMemberBlockedByMoney();

  await page.goto("/admin/members");
  await page
    .getByPlaceholder("Tìm theo tên, biệt danh hoặc SĐT...")
    .fill(member.name);

  const row = page.getByText(member.name, { exact: true }).first();
  await expect(row).toBeVisible();

  await page.getByRole("button", { name: "Thêm tùy chọn" }).first().click();
  await page.getByRole("menuitem", { name: "Xóa thành viên" }).click();
  await page.getByRole("button", { name: "Xóa", exact: true }).click();

  // ĐÂY là phần hỏng: server từ chối, UI rollback, nhưng admin không thấy gì.
  await expect(page.getByText(/Không xóa được/)).toBeVisible({
    timeout: 10_000,
  });

  // Và thành viên phải còn nguyên (rollback đúng, không mất dữ liệu tiền).
  await expect(row).toBeVisible();
});

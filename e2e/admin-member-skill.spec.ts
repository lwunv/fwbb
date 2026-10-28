import { test, expect } from "@playwright/test";
import { createClient } from "@libsql/client";

/**
 * Admin khai trình độ hộ member, và ô giới tính có thêm LGBT.
 *
 * Bài đi đủ đường: mở hộp thoại thật, chọn trong ô thật, bấm Lưu, rồi ĐỌC
 * THẲNG DB. Phần action đã có test riêng; cái bài này lo là đoạn nối giữa ô
 * chọn trên màn hình và formData gửi lên, chỗ mà một cái tên field gõ sai sẽ
 * làm thao tác im lặng không có tác dụng gì.
 */

function db() {
  return createClient({ url: "file:e2e/local.db" });
}

let memberId: number;
let memberName: string;

test.beforeAll(async () => {
  const c = db();
  await c.execute("PRAGMA busy_timeout = 5000");
  const m = (
    await c.execute(
      // OFFSET 1 có chủ ý: `me-skill-level.spec.ts` lấy member ĐẦU TIÊN và
      // cũng đặt rồi xoá `skill_level` của nó. Hai bài cùng giành một hàng thì
      // phần dọn dẹp của bài này xoá mất thứ bài kia vừa đặt, và bài kia đỏ
      // một cách ngẫu nhiên tuỳ thứ tự chạy. Mỗi bài một member thì hết.
      "SELECT id, name FROM members WHERE is_active=1 AND approval_status='approved' ORDER BY id LIMIT 1 OFFSET 1",
    )
  ).rows[0];
  memberId = Number(m.id);
  memberName = String(m.name);
  await c.execute(
    "UPDATE members SET skill_level=NULL, gender=NULL WHERE id=?",
    [memberId],
  );
  c.close();
});

test.afterAll(async () => {
  const c = db();
  await c.execute("PRAGMA busy_timeout = 5000");
  await c.execute(
    "UPDATE members SET skill_level=NULL, gender=NULL WHERE id=?",
    [memberId],
  );
  c.close();
});

async function read(col: "skill_level" | "gender"): Promise<string | null> {
  const c = db();
  await c.execute("PRAGMA busy_timeout = 5000");
  try {
    const r = await c.execute({
      sql: `SELECT ${col} AS v FROM members WHERE id=?`,
      args: [memberId],
    });
    const v = r.rows[0]?.v;
    return v === null || v === undefined ? null : String(v);
  } finally {
    c.close();
  }
}

test("admin đặt trình độ và giới tính LGBT cho member rồi lưu xuống DB", async ({
  page,
}) => {
  await page.goto("/admin/members", { waitUntil: "domcontentloaded" });

  // Tìm đúng dòng của member rồi mở hộp thoại "Sửa thông tin" của dòng đó.
  await page.getByPlaceholder(/Tìm theo tên/).fill(memberName);
  const edit = page.locator('button[title="Sửa thông tin"]').first();
  await expect(edit).toBeVisible({ timeout: 20_000 });
  await edit.click();

  await expect(page.getByText("Sửa thông tin thành viên")).toBeVisible();

  // Giới tính → LGBT.
  await page.getByRole("button", { name: /Giới tính/ }).click();
  await page.getByText("LGBT", { exact: true }).click();

  // Trình độ → TBY.
  await page.getByRole("button", { name: /Trình độ/ }).click();
  await page.getByText("TBY", { exact: true }).click();

  await page.getByRole("button", { name: "Lưu", exact: true }).click();

  await expect.poll(() => read("skill_level"), { timeout: 10_000 }).toBe("tby");
  await expect.poll(() => read("gender"), { timeout: 10_000 }).toBe("lgbt");

  // Nhãn phải hiện NGAY trong danh sách, không bắt admin tải lại trang.
  await expect(page.getByText("TBY", { exact: true }).first()).toBeVisible({
    timeout: 10_000,
  });
  // Kèm câu mô tả, vì ở màn quản lý admin cần đọc được ý nghĩa của mức.
  await expect(
    page.getByText("Trình bằng Yếu mà ảo tưởng hơn").first(),
  ).toBeVisible({ timeout: 10_000 });

  // Trình độ phải nằm ở CỘT RIÊNG, không nhét chung ô tên. Kiểm bằng cách
  // đếm ô: ô thứ 2 của dòng là ô trình độ, và ô thứ 1 (tên) KHÔNG được chứa
  // nhãn nữa.
  await expect(
    page.getByRole("columnheader", { name: "Trình độ" }),
  ).toBeVisible();
  const row = page.locator("tbody tr").first();
  await expect(row.locator("td").nth(1)).toContainText("TBY");
  await expect(row.locator("td").nth(0)).not.toContainText("TBY");

  // Và sống qua reload, tức nó đọc từ server chứ không chỉ là state màn hình.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByPlaceholder(/Tìm theo tên/).fill(memberName);
  await expect(page.getByText("TBY", { exact: true }).first()).toBeVisible({
    timeout: 10_000,
  });
});

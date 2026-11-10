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
  // Trang members stream từng mảnh: lúc chưa xong, DOM còn một ô tìm kiếm
  // ẨN cùng placeholder. Bản thật luôn là bản sau.
  await page
    .getByPlaceholder(/Tìm theo tên/)
    .last()
    .fill(memberName);
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
  // Trình độ phải nằm ở CỘT RIÊNG, không nhét chung ô tên. Kiểm bằng cách
  // đếm ô: ô thứ 2 của dòng là ô trình độ, và ô thứ 1 (tên) KHÔNG được chứa
  // nhãn nữa.
  await expect(
    page.getByRole("columnheader", { name: "Trình độ" }),
  ).toBeVisible();
  const row = page.locator("tbody tr").first();
  await expect(row.locator("td").nth(1)).toContainText("TBY");
  await expect(row.locator("td").nth(0)).not.toContainText("TBY");

  // Câu mô tả KHÔNG nằm sẵn trên dòng (sửa 28/10/2026): nó dài hơn cả tên
  // người. Admin rê chuột vào nhãn thì mới hiện, rê ra thì tắt.
  const blurb = page.getByRole("tooltip");
  await expect(blurb).toHaveCount(0);
  await row.locator("td").nth(1).getByRole("button", { name: "TBY" }).hover();
  await expect(blurb).toHaveText("Trình bằng Yếu mà ảo tưởng hơn", {
    timeout: 10_000,
  });
  await page.getByRole("columnheader", { name: "Trình độ" }).hover();
  await expect(blurb).toHaveCount(0);

  // Và sống qua reload, tức nó đọc từ server chứ không chỉ là state màn hình.
  await page.reload({ waitUntil: "domcontentloaded" });
  // Trang members stream từng mảnh: lúc chưa xong, DOM còn một ô tìm kiếm
  // ẨN cùng placeholder. Bản thật luôn là bản sau.
  await page
    .getByPlaceholder(/Tìm theo tên/)
    .last()
    .fill(memberName);
  await expect(page.getByText("TBY", { exact: true }).first()).toBeVisible({
    timeout: 10_000,
  });
});

// Yêu cầu 6/11/2026: đổi trình độ NGAY trên dòng, lọc và sắp theo trình độ.
test("admin đổi trình độ ngay trên dòng, lọc và sắp theo trình độ", async ({
  page,
}) => {
  await page.goto("/admin/members", { waitUntil: "domcontentloaded" });
  // Gõ lại tới khi danh sách lọc đúng: trang stream + hydrate, gõ quá sớm thì
  // chữ bị mất, dòng đầu là người khác và bài đổi nhầm trình độ của họ
  // (dính 6/11/2026).
  const row = page.locator("tbody tr").first();
  await expect(async () => {
    await page
      .getByPlaceholder(/Tìm theo tên/)
      .last()
      .fill(memberName);
    await expect(row).toContainText(memberName, { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  const inline = row.getByRole("button", { name: "Đổi trình độ" });
  await expect(inline).toBeVisible({ timeout: 20_000 });
  await inline.click();
  // Menu trình độ mới (base-ui): mỗi mức là menuitem, tên kèm câu mô tả.
  await page.getByRole("menuitem", { name: /^TBK/ }).click();
  await expect.poll(() => read("skill_level"), { timeout: 10_000 }).toBe("tbk");
  // Chip màu cạnh dropdown cập nhật ngay (optimistic), không cần reload.
  await expect(row.locator("td").nth(1)).toContainText("TBK");

  // Lọc TBK: còn member này; lọc "Chưa khai": member này biến mất.
  await page.getByRole("button", { name: "Lọc theo trình độ" }).click();
  await page.getByRole("button", { name: "TBK", exact: true }).last().click();
  await expect(page.locator("tbody tr").first()).toContainText(memberName);
  await page.getByRole("button", { name: "Lọc theo trình độ" }).click();
  await page
    .getByRole("button", { name: "Chưa khai", exact: true })
    .last()
    .click();
  await expect(page.locator("tbody tr", { hasText: memberName })).toHaveCount(
    0,
  );

  // Bỏ lọc + bỏ tìm, sắp theo cột Trình độ (lần bấm đầu = cao → thấp): dòng
  // đầu phải là một người TBK, mức cao nhất đang có.
  await page.getByRole("button", { name: "Lọc theo trình độ" }).click();
  await page
    .getByRole("button", { name: "Tất cả", exact: true })
    .last()
    .click();
  await page
    .getByPlaceholder(/Tìm theo tên/)
    .last()
    .fill("");
  await page.getByRole("columnheader", { name: "Trình độ" }).click();
  await expect(
    page.locator("tbody tr").first().locator("td").nth(1),
  ).toContainText("TBK");
});

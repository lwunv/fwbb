import { test, expect } from "@playwright/test";
import { createClient } from "@libsql/client";

/**
 * Công tắc giới tính bật/tắt phải đổi đúng những gì admin NHÌN THẤY.
 *
 * Phần tính tiền đã có test tích hợp phủ kỹ (`finalize-gender.integration.test.ts`,
 * 7 ca gồm cả ca "tắt công tắc thì tiền y hệt như cũ"). Bài e2e này lo phần mà
 * test tích hợp không với tới: ba nhóm nữ trên trang Cài đặt, và ô "trong đó
 * nữ" ở màn quản lý vote, có mọc đúng theo công tắc hay không.
 *
 * Tự dọn: trả công tắc về mặc định (tắt) trong `finally`, nếu không thì mọi
 * bài sau chạy trên một cấu hình khác hẳn.
 */

const TEST_DATE = "2099-07-20";

async function db() {
  const c = createClient({ url: "file:e2e/local.db" });
  // Fixture và server Next mở CÙNG file, chờ lock nhả thay vì chết ngay.
  await c.execute("PRAGMA busy_timeout = 5000");
  return c;
}

async function setGenderPricing(on: boolean) {
  const c = await db();
  try {
    await c.execute({
      sql: "INSERT INTO app_settings (key, value) VALUES ('genderPricingEnabled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      args: [JSON.stringify(on)],
    });
  } finally {
    c.close();
  }
}

async function clearGenderPricing() {
  const c = await db();
  try {
    await c.execute(
      "DELETE FROM app_settings WHERE key='genderPricingEnabled'",
    );
    await c.execute("DELETE FROM sessions WHERE date=?", [TEST_DATE]);
  } finally {
    c.close();
  }
}

const FEMALE_LABELS = [
  "Thành viên nữ",
  "Khách nữ của thành viên",
  "Khách nữ của admin",
];

test.describe("công tắc giới tính", () => {
  test.afterAll(clearGenderPricing);

  test("trang Cài đặt: TẮT thì không có nhóm nữ nào, BẬT thì hiện đủ ba", async ({
    page,
  }) => {
    await setGenderPricing(false);
    await page.goto("/admin/settings", { waitUntil: "domcontentloaded" });
    for (const label of FEMALE_LABELS) {
      await expect(page.getByText(label)).toHaveCount(0);
    }
    // Nhóm thường vẫn còn — chứng minh section có render, không phải trang lỗi.
    await expect(
      page.getByRole("button", { name: "Cách tính: Thành viên" }),
    ).toBeVisible();

    await setGenderPricing(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    for (const label of FEMALE_LABELS) {
      // Mỗi nhãn hiện ở thẻ nhóm + ô xem trước + dòng kết quả, nên chỉ cần
      // "có ít nhất một".
      await expect(page.getByText(label).first()).toBeVisible();
    }
  });

  test('màn quản lý vote: ô "trong đó nữ" chỉ mọc khi công tắc bật và có khách', async ({
    page,
  }) => {
    const c = await db();
    let sessionId: number;
    try {
      const adminRow = (
        await c.execute(
          "SELECT member_id FROM admins WHERE member_id IS NOT NULL LIMIT 1",
        )
      ).rows[0];
      const adminMemberId = Number(adminRow.member_id);

      await c.execute("DELETE FROM sessions WHERE date=?", [TEST_DATE]);
      const ins = await c.execute({
        sql: `INSERT INTO sessions (date, court_quantity, court_price, dining_bill, status, use_min_deduction)
              VALUES (?, 1, 150000, 0, 'voting', 0)`,
        args: [TEST_DATE],
      });
      sessionId = Number(ins.lastInsertRowid);
      // Admin vote chơi kèm 2 khách → ô đếm khách có giá trị > 0, điều kiện để
      // ô "trong đó nữ" được phép mọc.
      await c.execute({
        sql: `INSERT INTO votes (session_id, member_id, will_play, will_dine, guest_play_count, guest_dine_count, with_partner)
              VALUES (?, ?, 1, 0, 2, 0, 0)`,
        args: [sessionId, adminMemberId],
      });
    } finally {
      c.close();
    }

    const openGuestBlock = async () => {
      // Ô đếm khách nằm trong khối gập, phải bấm "Thêm khách" mới mở.
      await page.getByRole("button", { name: "Thêm khách" }).first().click();
    };

    // --- Công tắc TẮT: mở khối khách ra vẫn KHÔNG có ô "trong đó nữ" ---
    await setGenderPricing(false);
    await page.goto(`/admin/sessions/${sessionId}`, {
      waitUntil: "domcontentloaded",
    });
    await openGuestBlock();
    // Ô đếm khách thường phải có mặt — chứng minh khối đã mở thật, nên việc
    // không thấy "trong đó nữ" là do công tắc tắt chứ không phải do chưa mở.
    await expect(page.getByText("🏸").first()).toBeVisible();
    await expect(page.getByText("trong đó nữ")).toHaveCount(0);

    // --- Công tắc BẬT: cùng thao tác, ô "trong đó nữ" phải mọc ra ---
    await setGenderPricing(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await openGuestBlock();
    await expect(page.getByText("trong đó nữ").first()).toBeVisible();
  });
});

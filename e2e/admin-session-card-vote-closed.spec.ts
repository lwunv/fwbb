import { test, expect } from "@playwright/test";
import { createClient } from "@libsql/client";

/**
 * Thẻ buổi của admin có viền LED nháy nghĩa là "buổi đang sống, vote đang mở".
 * Buổi đã XÁC NHẬN (status confirmed) mà hạn vote đã qua thì vote đóng rồi, LED
 * phải tắt. Trước đây trạng thái "đã đóng vote" chỉ được tính cho buổi status
 * voting, nên buổi confirmed vẫn nháy LED trong khi đồng hồ ngay cạnh báo "Đã
 * đóng vote". Hai test dưới chốt cả chiều tắt và chiều còn sáng.
 */

const CLOSED_DATE = "2099-08-02";
const OPEN_DATE = "2099-08-03";
const PAST_DEADLINE = "2020-01-01T00:00:00";
const FUTURE_DEADLINE = "2099-12-31T20:00:00";

async function db() {
  const c = createClient({ url: "file:e2e/local.db" });
  // Fixture và server Next mở CÙNG file e2e/local.db, nên ghi đồng thời làm
  // SQLITE_BUSY. Chờ lock nhả thay vì chết ngay. Cùng cách src/db/test-db.ts
  // đã dùng cho test tích hợp.
  await c.execute("PRAGMA busy_timeout = 5000");
  return c;
}

// DELETE FROM sessions thẳng tay: AGENTS.md cấm trong code app (deleteSession
// phải reverse fund_deductions trước), nhưng đây là fixture trên DB throwaway
// file:e2e/local.db, với buổi ngày 2099 do chính spec tạo và chưa từng chốt sổ
// nên không có ledger nào để reverse. Cùng pattern e2e/vote-contact.spec.ts.
async function seed(date: string, deadline: string) {
  const c = await db();
  await c.execute({ sql: "DELETE FROM sessions WHERE date=?", args: [date] });
  const r = await c.execute({
    sql: "INSERT INTO sessions (date, status, vote_deadline) VALUES (?, 'confirmed', ?)",
    args: [date, deadline],
  });
  c.close();
  return Number(r.lastInsertRowid);
}

let closedId: number;
let openId: number;

test.beforeAll(async () => {
  closedId = await seed(CLOSED_DATE, PAST_DEADLINE);
  openId = await seed(OPEN_DATE, FUTURE_DEADLINE);
});

test.afterAll(async () => {
  const c = await db();
  for (const date of [CLOSED_DATE, OPEN_DATE]) {
    await c.execute({ sql: "DELETE FROM sessions WHERE date=?", args: [date] });
  }
  c.close();
});

test("buổi đã xác nhận mà hết hạn vote: LED tắt, đồng hồ báo đã đóng", async ({
  page,
}) => {
  await page.goto(`/admin/sessions/${closedId}`);

  await expect(page.getByText("Đã đóng vote")).toBeVisible();
  // Nút cũng phải mời mở lại vote.
  await expect(page.getByRole("button", { name: "Mở vote" })).toBeVisible();
  // Đèn TẮT nhưng KHUNG vẫn còn (đổi 22/9/2026).
  //
  // Bản cũ kiểm "đèn tắt" bằng cách đòi lớp bọc `.led-border` biến mất. Bỏ hẳn
  // lớp bọc cũng bỏ luôn 3px padding của nó, nên thẻ tắt đèn hụt 6px so với
  // thẻ sáng đèn và nhảy một cái mỗi lần đổi buổi. Giờ lớp bọc luôn ở đó, chỉ
  // thêm `led-off` để thôi vẽ, nên phải kiểm đúng cái đó: còn khung, và không
  // còn lớp bọc nào đang sáng.
  await expect(page.locator(".led-border.led-off")).toHaveCount(1);
  await expect(page.locator(".led-border:not(.led-off)")).toHaveCount(0);
});

test("buổi đã xác nhận còn hạn vote: LED vẫn sáng", async ({ page }) => {
  await page.goto(`/admin/sessions/${openId}`);

  await expect(page.getByRole("button", { name: "Khóa vote" })).toBeVisible();
  // Đang sáng = lớp bọc KHÔNG mang `led-off`.
  await expect(
    page.locator('.led-border:not(.led-off) [data-slot="card"]').first(),
  ).toBeVisible();
});

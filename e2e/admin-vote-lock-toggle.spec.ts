import { test, expect } from "@playwright/test";
import { createClient } from "@libsql/client";

/**
 * Nút khóa/mở vote phải là toggle thật: buổi đã đóng vote thì admin bấm "Mở
 * vote" ngay trên thẻ buổi, không phải mò vào dialog "Đặt deadline" rồi "Bỏ
 * deadline". Test đi qua UI thật (chi tiết buổi) và kiểm cả cột DB.
 */

// Ngày xa tương lai để không đụng buổi thật hay buổi của spec khác.
const TEST_DATE = "2099-08-01";
// Hạn vote ở quá khứ = vote đang ĐÓNG (giống sau khi admin bấm "Khóa vote").
const PAST_DEADLINE = "2020-01-01T00:00:00";

function db() {
  return createClient({ url: "file:e2e/local.db" });
}

// Về DELETE FROM sessions thẳng tay ở đây: AGENTS.md cấm nó trong code app vì
// deleteSession phải reverse fund_deductions trước. Fixture này chạy trên DB
// throwaway (file:e2e/local.db), trên một buổi ngày 2099 do chính nó tạo, chưa
// từng chốt sổ nên không có ledger nào để reverse. Cùng pattern với
// e2e/vote-contact.spec.ts.

let sessionId: number;

test.beforeAll(async () => {
  const c = db();
  await c.execute({
    sql: "DELETE FROM sessions WHERE date=?",
    args: [TEST_DATE],
  });
  const inserted = await c.execute({
    sql: "INSERT INTO sessions (date, status, vote_deadline) VALUES (?, 'voting', ?)",
    args: [TEST_DATE, PAST_DEADLINE],
  });
  sessionId = Number(inserted.lastInsertRowid);
  c.close();
});

test.afterAll(async () => {
  const c = db();
  await c.execute({
    sql: "DELETE FROM votes WHERE session_id=?",
    args: [sessionId],
  });
  await c.execute({
    sql: "DELETE FROM sessions WHERE date=?",
    args: [TEST_DATE],
  });
  c.close();
});

async function readDeadline(): Promise<string | null> {
  const c = db();
  const row = (
    await c.execute({
      sql: "SELECT vote_deadline FROM sessions WHERE id=?",
      args: [sessionId],
    })
  ).rows[0];
  c.close();
  return (row?.vote_deadline as string | null) ?? null;
}

test("admin mở lại vote đã khóa rồi khóa lại, ngay trên một nút", async ({
  page,
}) => {
  await page.goto(`/admin/sessions/${sessionId}`);

  // Vote đang đóng → nút phải mời "Mở vote".
  const reopen = page.getByRole("button", { name: "Mở vote" });
  await expect(reopen).toBeVisible();

  await reopen.click();

  // Mở xong: nhãn nút quay về chiều khóa, và chỗ đồng hồ nói rõ vote không hạn.
  await expect(page.getByRole("button", { name: "Khóa vote" })).toBeVisible();
  await expect(page.getByText("Đang mở (không hạn)")).toBeVisible();
  await expect.poll(readDeadline, { timeout: 10_000 }).toBeNull();

  // Khóa lại được ngay, không cần reload trang.
  await page.getByRole("button", { name: "Khóa vote" }).click();
  await expect(page.getByRole("button", { name: "Mở vote" })).toBeVisible();
  await expect.poll(readDeadline, { timeout: 10_000 }).not.toBeNull();
});

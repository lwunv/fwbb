import { test, expect } from "@playwright/test";
import { createClient } from "@libsql/client";
import bcrypt from "bcryptjs";

// Logged-out context — selector chỉ hiện cho member đã đăng nhập (gate layout).
test.use({ storageState: { cookies: [], origins: [] } });

const EMAIL = "e2eweek@example.com";
const PASSWORD = "weekselector123";

/** Replicate badmintonDatesForTargetWeek([1,3,5]) — T2/4/6 tuần đích (T7/CN → tuần sau). */
function targetDates(): string[] {
  const vn = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  const today = vn(new Date());
  const base = new Date(`${today}T12:00:00+07:00`);
  const dow = base.getUTCDay();
  const fromMon = (d: number) => (d === 0 ? 6 : d - 1);
  const shift = dow === 6 || dow === 0 ? 7 : 0;
  const monOff = -fromMon(dow) + shift;
  return [1, 3, 5].map((d) =>
    vn(new Date(base.getTime() + (monOff + fromMon(d)) * 86_400_000)),
  );
}

test.beforeAll(async () => {
  const c = createClient({ url: "file:e2e/local.db" });
  // Member active+approved → set password/email để login; clear nợ để vào nhánh
  // selector (member còn nợ đi nhánh thanh toán).
  const m = (
    await c.execute(
      "SELECT id FROM members WHERE is_active=1 AND approval_status='approved' ORDER BY id LIMIT 1",
    )
  ).rows[0];
  const hash = await bcrypt.hash(PASSWORD, 10);
  await c.execute({
    sql: "UPDATE members SET password_hash=?, email=? WHERE id=?",
    args: [hash, EMAIL, m.id],
  });
  await c.execute("DELETE FROM financial_transactions WHERE member_id=?", [
    m.id,
  ]);
  await c.execute("DELETE FROM rate_limit_buckets");

  const court = (await c.execute("SELECT id FROM courts LIMIT 1")).rows[0];
  for (const date of targetDates()) {
    await c.execute("DELETE FROM sessions WHERE date=?", [date]);
    // voteDeadline cuối ngày → countdown (HH:MM:SS) chắc chắn còn thời gian.
    await c.execute({
      sql: `INSERT INTO sessions (date, start_time, end_time, court_id, court_quantity, court_price, status, vote_deadline)
            VALUES (?, '20:30', '22:30', ?, 1, 200000, 'voting', ?)`,
      args: [date, court?.id ?? null, `${date}T23:59:59`],
    });
  }
  c.close();
});

// Chặn SDK ngoài → gate fallback về form email/mật khẩu ngay.
test.beforeEach(async ({ page }) => {
  await page.route(
    /connect\.facebook\.net|accounts\.google\.com|apis\.google\.com|gsi\//,
    (r) => r.abort(),
  );
});

test.describe("selector thứ cầu lông + countdown trong card (e2e)", () => {
  test("login member → home hiện 3 chip thứ, click được, countdown HH:MM:SS trong card", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator('input[type="email"]')).toBeVisible({
      timeout: 20_000,
    });
    await page.locator('input[type="email"]').fill(EMAIL);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.locator('button[type="submit"]').click();

    // Rời gate → home member: 3 chip thứ (Thứ Hai/Tư/Sáu).
    const chips = page.getByRole("button", { name: /Thứ/ });
    await expect(chips).toHaveCount(3, { timeout: 15_000 });

    // Đồng hồ đếm ngược theo GIÂY hiện TRONG card (HH:MM:SS).
    await expect(page.getByText(/\d{1,2}:\d{2}:\d{2}/).first()).toBeVisible({
      timeout: 10_000,
    });

    // Click chip thứ 2 → vẫn render card buổi đó (header ngày dd/MM/yyyy).
    await chips.nth(1).click();
    await expect(page.getByText(/\d{2}\/\d{2}\/\d{4}/).first()).toBeVisible();
  });
});

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
  const dates = targetDates();
  for (const date of dates) {
    await c.execute("DELETE FROM sessions WHERE date=?", [date]);
  }
  // Deadline = NOW + 6h (giờ local) → countdown LUÔN còn thời gian (< 1 ngày →
  // hiện "còn HH:MM:SS"), KHÔNG phụ thuộc thứ chạy test → tránh flake theo ngày.
  const dl = new Date(Date.now() + 6 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  const deadline = `${dl.getFullYear()}-${p(dl.getMonth() + 1)}-${p(dl.getDate())}T${p(dl.getHours())}:${p(dl.getMinutes())}:${p(dl.getSeconds())}`;
  // Seed buổi cho T2 (dates[0]) + T6 (dates[2]); CHỪA T4 (dates[1]) trống để
  // test chip "chưa có buổi".
  for (const date of [dates[0], dates[2]]) {
    await c.execute({
      sql: `INSERT INTO sessions (date, start_time, end_time, court_id, court_quantity, court_price, status, vote_deadline)
            VALUES (?, '20:30', '22:30', ?, 1, 200000, 'voting', ?)`,
      args: [date, court?.id ?? null, deadline],
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
  test("login member → ĐỦ 3 chip thứ (kể cả ngày trống), countdown trong card, empty-state", async ({
    page,
  }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    // Mode mặc định = login — ô định danh đa kênh (username/sđt/email), không
    // phải input[type=email] (chỉ có ở mode đăng ký).
    const identifier = page.getByPlaceholder("Username / SĐT / Email");
    await expect(identifier).toBeVisible({ timeout: 20_000 });
    await identifier.fill(EMAIL);
    await page.getByPlaceholder("Mật khẩu (≥ 8 ký tự)").fill(PASSWORD);
    await page.locator('button[type="submit"]').click();

    // ĐỦ 3 chip thứ cầu lông (T2/T4/T6) — kể cả T4 chưa có buổi.
    const chips = page.getByRole("button", { name: /Thứ/ });
    await expect(chips).toHaveCount(3, { timeout: 15_000 });

    // Countdown gọn "còn HH:MM:SS" (scoped, không khớp giờ buổi 20:30). Nút
    // copy-link đã bị bỏ khỏi trang chủ từ commit f060275 ("drop ... copy-link")
    // — giờ chỉ còn ở header của /vote/[id] — nên page chủ KHÔNG BAO GIỜ có
    // nút này, dù buổi có hay không.
    const countdown = page.getByText(/còn \d{1,2}:\d{2}:\d{2}/);
    const copyLink = page.getByRole("button", { name: /Sao chép/i });

    // Mặc định chọn buổi sắp tới có sẵn (T2) → countdown TRONG card.
    await expect(countdown.first()).toBeVisible({ timeout: 10_000 });
    await expect(copyLink).toHaveCount(0);

    // Click chip giữa (T4, chưa có buổi) → empty state; KHÔNG countdown.
    await chips.nth(1).click();
    await expect(page.getByText(/Chưa có buổi/)).toBeVisible({
      timeout: 10_000,
    });
    await expect(countdown).toHaveCount(0);
    await expect(copyLink).toHaveCount(0);

    // Quay lại chip T2 (có buổi) → countdown lại hiện (vẫn không có copy-link).
    await chips.nth(0).click();
    await expect(countdown.first()).toBeVisible({ timeout: 10_000 });
    await expect(copyLink).toHaveCount(0);
  });
});

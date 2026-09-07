import { test, expect } from "@playwright/test";
import { createClient } from "@libsql/client";
import bcrypt from "bcryptjs";

// Logged-out context — selector chỉ hiện cho member đã đăng nhập (gate layout).
test.use({ storageState: { cookies: [], origins: [] } });

const EMAIL = "e2eadhoc@example.com";
const PASSWORD = "adhochome123";

/** Replicate badmintonDatesForTargetWeek([1,3,5]) — T2/4/6 tuần đích (T7/CN → tuần sau). */
function vnYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function targetDates(): string[] {
  const today = vnYmd(new Date());
  const base = new Date(`${today}T12:00:00+07:00`);
  const dow = base.getUTCDay();
  const fromMon = (d: number) => (d === 0 ? 6 : d - 1);
  const shift = dow === 6 || dow === 0 ? 7 : 0;
  const monOff = -fromMon(dow) + shift;
  return [1, 3, 5].map((d) =>
    vnYmd(new Date(base.getTime() + (monOff + fromMon(d)) * 86_400_000)),
  );
}

// Buổi ad-hoc phải nằm trong cửa sổ [hôm nay, ngày mai] của getNextSession và
// KHÔNG trùng ngày nào của selector — chọn hôm nay nếu được, không thì ngày mai
// (luôn có 1 trong 2 thỏa vì T2/4/6 không bao giờ là 2 ngày liên tiếp).
const TODAY = vnYmd(new Date());
const TOMORROW = vnYmd(new Date(Date.now() + 86_400_000));
const TARGETS = targetDates();
const ADHOC_DATE = TARGETS.includes(TODAY) ? TOMORROW : TODAY;
// Các ngày selector được seed buổi — CHỪA hôm nay/ngày mai để getNextSession
// luôn trả về buổi ad-hoc (nó lấy buổi active sớm nhất trong [today, tomorrow]).
const SEED_TARGETS = TARGETS.filter((d) => d !== TODAY && d !== TOMORROW);

test.beforeAll(async () => {
  const c = createClient({ url: "file:e2e/local.db" });
  // Fixture và server Next mở CÙNG file e2e/local.db → ghi đồng thời sinh
  // SQLITE_BUSY. Chờ lock nhả thay vì chết ngay.
  await c.execute("PRAGMA busy_timeout = 5000");
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
  for (const date of [...TARGETS, ADHOC_DATE]) {
    await c.execute("DELETE FROM sessions WHERE date=?", [date]);
  }
  // Deadline = NOW + 6h (giờ local) → vote luôn đang mở, không flake theo ngày.
  const dl = new Date(Date.now() + 6 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  const deadline = `${dl.getFullYear()}-${p(dl.getMonth() + 1)}-${p(dl.getDate())}T${p(dl.getHours())}:${p(dl.getMinutes())}:${p(dl.getSeconds())}`;
  for (const date of [ADHOC_DATE, ...SEED_TARGETS]) {
    await c.execute({
      sql: `INSERT INTO sessions (date, start_time, end_time, court_id, court_quantity, court_price, status, vote_deadline)
            VALUES (?, '20:30', '22:30', ?, 1, 200000, 'voting', ?)`,
      args: [date, court?.id ?? null, deadline],
    });
  }
  c.close();
});

// Trả DB về trạng thái không còn buổi ad-hoc — các spec sau (week-selector)
// expect đúng 3 chip.
test.afterAll(async () => {
  const c = createClient({ url: "file:e2e/local.db" });
  // Fixture và server Next mở CÙNG file e2e/local.db → ghi đồng thời sinh
  // SQLITE_BUSY. Chờ lock nhả thay vì chết ngay.
  await c.execute("PRAGMA busy_timeout = 5000");
  for (const date of [ADHOC_DATE, ...SEED_TARGETS]) {
    await c.execute("DELETE FROM sessions WHERE date=?", [date]);
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

test.describe("buổi ad-hoc ngoài lịch cố định hiện trên trang chủ (e2e)", () => {
  test("login member → selector có thêm chip buổi ad-hoc và chọn nó mặc định", async ({
    page,
  }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    const identifier = page.getByPlaceholder("Username / SĐT / Email");
    await expect(identifier).toBeVisible({ timeout: 20_000 });
    await identifier.fill(EMAIL);
    await page.getByPlaceholder("Mật khẩu (≥ 8 ký tự)").fill(PASSWORD);
    await page.locator('button[type="submit"]').click();

    // 3 chip thứ cố định (T2/T4/T6) + 1 chip buổi ad-hoc = 4.
    const chips = page.getByRole("button", { name: /Thứ|Chủ [Nn]hật/ });
    await expect(chips).toHaveCount(4, { timeout: 15_000 });

    // Buổi ad-hoc là buổi sắp tới gần nhất → được chọn mặc định, panel hiện
    // đúng ngày của nó (heading SessionCard format "EEEE, dd/MM/yyyy").
    const [y, mo, d] = ADHOC_DATE.split("-");
    await expect(
      page.getByText(new RegExp(`${d}/${mo}/${y}`)).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});

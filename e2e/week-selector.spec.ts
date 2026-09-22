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

/** YYYY-MM-DD theo giờ VN. */
function ymdVN(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Chỉ số chip trống / chip có buổi, quyết định ở beforeAll theo lịch chạy. */
let emptyChipIdx = 1;
let seededChipIdx = 2;

test.beforeAll(async () => {
  const c = createClient({ url: "file:e2e/local.db" });
  // Fixture và server Next mở CÙNG file e2e/local.db → ghi đồng thời sinh
  // SQLITE_BUSY. Chờ lock nhả thay vì chết ngay.
  await c.execute("PRAGMA busy_timeout = 5000");
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
  // Kiểm NGAY là đã xoá sạch. Bài này dựa vào việc dates[1] KHÔNG có buổi để
  // kiểm trạng thái rỗng, mà fixture dùng chung nên buổi ở ngày đó có thể do
  // bài khác tạo ra. Xoá hụt thì trước đây bài đỏ ở tận assertion cuối với
  // thông báo "không thấy chữ Chưa có buổi", chẳng nói gì về nguyên nhân.
  const conLai = await c.execute({
    sql: `SELECT date FROM sessions WHERE date IN (?, ?, ?)`,
    args: [dates[0], dates[1], dates[2]],
  });
  if (conLai.rows.length > 0) {
    throw new Error(
      `khong xoa duoc buoi o cac ngay test: ${conLai.rows.map((r) => r.date).join(", ")}`,
    );
  }
  // Deadline = NOW + 6h (giờ local) → countdown LUÔN còn thời gian (< 1 ngày →
  // hiện "còn HH:MM:SS"), KHÔNG phụ thuộc thứ chạy test → tránh flake theo ngày.
  const dl = new Date(Date.now() + 6 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  const deadline = `${dl.getFullYear()}-${p(dl.getMonth() + 1)}-${p(dl.getDate())}T${p(dl.getHours())}:${p(dl.getMinutes())}:${p(dl.getSeconds())}`;
  // CHỪA một ngày trống để kiểm trạng thái "chưa có buổi" — nhưng KHÔNG được
  // chừa cố định dates[1].
  //
  // Lý do: `getNextSession` TỰ TẠO buổi cho hôm nay hoặc ngày mai nếu đó là
  // ngày chơi và chưa có buổi (`sessions.ts`, nhánh auto-create). Nên ngày
  // trống mà rơi vào hôm nay/ngày mai thì vừa tải trang là nó mọc lại, và
  // assertion "chưa có buổi" đỏ. Bài này xanh suốt chỉ vì toàn chạy hôm thứ
  // Hai (lúc đó ngày bị chừa là T4, không phải hôm nay/mai); sang thứ Ba là
  // T4 thành "ngày mai" và đỏ ngay — dính đúng 22/9/2026.
  //
  // Chọn ngày trống là ngày CUỐI trong ba ngày mà không phải hôm nay cũng
  // không phải ngày mai. Với mọi thứ trong tuần luôn tồn tại ít nhất một ngày
  // như vậy (T7/CN thì cả tuần đã dời sang tuần sau).
  const homNay = ymdVN(new Date());
  const ngayMai = ymdVN(new Date(Date.now() + 86_400_000));
  const emptyIdx = (() => {
    for (let i = dates.length - 1; i >= 0; i--) {
      if (dates[i] !== homNay && dates[i] !== ngayMai) return i;
    }
    throw new Error("khong tim duoc ngay trong an toan");
  })();
  const seededIdx = [0, 1, 2].filter((i) => i !== emptyIdx);
  emptyChipIdx = emptyIdx;
  seededChipIdx = seededIdx[seededIdx.length - 1];
  for (const date of seededIdx.map((i) => dates[i])) {
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

    // Neo vào chip T6 (dates[2]), KHÔNG phải T2 và cũng không dựa vào chip nào
    // được chọn sẵn.
    //
    // Bản cũ giả định "mặc định chọn buổi sắp tới (T2)" và xanh suốt vì tình
    // cờ toàn chạy vào thứ Hai. Sang thứ Ba là T2 thành quá khứ, buổi đó hết
    // đếm ngược và bài đỏ — đúng 22/9/2026 thì dính. T6 là ngày DUY NHẤT trong
    // ba chip luôn còn ở hiện tại hoặc tương lai với mọi thứ trong tuần (T7/CN
    // thì `targetDates` đã dời sang tuần sau), nên neo vào đó là hết phụ thuộc
    // ngày chạy.
    await chips.nth(seededChipIdx).click();
    await expect(countdown.first()).toBeVisible({ timeout: 10_000 });
    await expect(copyLink).toHaveCount(0);

    // Chip của ngày ĐƯỢC CHỪA TRỐNG → empty state; KHÔNG countdown.
    await chips.nth(emptyChipIdx).click();
    await expect(page.getByText(/Chưa có buổi/)).toBeVisible({
      timeout: 10_000,
    });
    await expect(countdown).toHaveCount(0);
    await expect(copyLink).toHaveCount(0);

    // Quay lại chip có buổi → countdown lại hiện (vẫn không có copy-link).
    await chips.nth(seededChipIdx).click();
    await expect(countdown.first()).toBeVisible({ timeout: 10_000 });
    await expect(copyLink).toHaveCount(0);
  });
});

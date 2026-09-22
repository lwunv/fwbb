import { test, expect } from "@playwright/test";
import { createClient } from "@libsql/client";
import bcrypt from "bcryptjs";

/**
 * Thẻ buổi chơi ở trang chủ phải giữ NGUYÊN kích thước dù có chạy viền LED
 * hay không.
 *
 * Viền LED là một lớp bọc có padding 3px. Bản đầu chỉ render lớp bọc đó khi
 * buổi đang vote, nên buổi không vote hụt đúng 6px cả ngang lẫn dọc: bấm qua
 * lại giữa các thứ trong tuần là thấy thẻ nảy một cái.
 *
 * Bài đo CÙNG MỘT buổi hai lần, đổi trạng thái ở giữa, thay vì so hai ngày
 * khác nhau. Bản đầu so hai ngày và nó phụ thuộc hôm nay là thứ mấy: chạy hôm
 * thứ Ba thì ngày thứ Hai đã thành quá khứ, buổi đó hết "đang vote" và hai
 * trạng thái bị đảo, làm phép đo mất ý nghĩa mà vẫn xanh.
 */

test.use({ storageState: { cookies: [], origins: [] } });

const EMAIL = "e2eled@example.com";
const PASSWORD = "ledborder123";

/** Ba ngày chơi của tuần đích, giống badmintonDatesForTargetWeek([1,3,5]). */
function targetDates(): string[] {
  const vn = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  const base = new Date(`${vn(new Date())}T12:00:00+07:00`);
  const dow = base.getUTCDay();
  const fromMon = (d: number) => (d === 0 ? 6 : d - 1);
  const shift = dow === 6 || dow === 0 ? 7 : 0;
  const monOff = -fromMon(dow) + shift;
  return [1, 3, 5].map((d) =>
    vn(new Date(base.getTime() + (monOff + fromMon(d)) * 86_400_000)),
  );
}

/** Ngày dùng để đo: thứ Sáu của tuần đích, ngày DUY NHẤT luôn là hôm nay hoặc
 *  tương lai với mọi thứ trong tuần (T7/CN thì cả tuần đã dời sang tuần sau). */
const DATE = targetDates()[2];
const CHIP_INDEX = 2;

function db() {
  const c = createClient({ url: "file:e2e/local.db" });
  return c;
}

async function setStatus(status: string) {
  const c = db();
  await c.execute("PRAGMA busy_timeout = 5000");
  await c.execute({
    sql: "UPDATE sessions SET status=? WHERE date=?",
    args: [status, DATE],
  });
  c.close();
}

test.beforeAll(async () => {
  const c = db();
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
  // Member còn nợ đi nhánh thanh toán, không thấy selector tuần.
  await c.execute("DELETE FROM financial_transactions WHERE member_id=?", [
    m.id,
  ]);
  await c.execute("DELETE FROM rate_limit_buckets");

  const court = (await c.execute("SELECT id FROM courts LIMIT 1")).rows[0];
  await c.execute("DELETE FROM sessions WHERE date=?", [DATE]);

  const dl = new Date(Date.now() + 6 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  const deadline = `${dl.getFullYear()}-${p(dl.getMonth() + 1)}-${p(dl.getDate())}T${p(dl.getHours())}:${p(dl.getMinutes())}:${p(dl.getSeconds())}`;
  await c.execute({
    sql: `INSERT INTO sessions (date, start_time, end_time, court_id, court_quantity, court_price, status, vote_deadline)
          VALUES (?, '20:30', '22:30', ?, 1, 200000, 'voting', ?)`,
    args: [DATE, court?.id ?? null, deadline],
  });
  c.close();
});

test.afterAll(async () => {
  const c = db();
  await c.execute("PRAGMA busy_timeout = 5000");
  await c.execute("DELETE FROM sessions WHERE date=?", [DATE]);
  c.close();
});

test.beforeEach(async ({ page }) => {
  await page.route(
    /connect\.facebook\.net|accounts\.google\.com|apis\.google\.com|gsi\//,
    (r) => r.abort(),
  );
});

test.describe("kích thước thẻ buổi chơi", () => {
  test("bật hay tắt viền LED, thẻ vẫn đúng một kích thước", async ({
    page,
  }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    // Ô định danh đa kênh (username/sđt/email), không phải input[type=email]:
    // input đó chỉ có ở mode đăng ký.
    const identifier = page.getByPlaceholder("Username / SĐT / Email");
    await expect(identifier).toBeVisible({ timeout: 20_000 });
    await identifier.fill(EMAIL);
    await page.getByPlaceholder("Mật khẩu (≥ 8 ký tự)").fill(PASSWORD);
    await page.locator('button[type="submit"]').click();

    const chips = page.getByRole("button", { name: /Thứ/ });
    await expect(chips).toHaveCount(3, { timeout: 20_000 });

    // Thẻ buổi chơi là thẻ CHỨA hàng chip thứ. Bắt theo `[data-slot=card]` chứ
    // không theo `.led-border > *`: khi lớp bọc biến mất (đúng lỗi cần bắt)
    // thì vẫn đo được và báo lệch bao nhiêu, thay vì "không tìm thấy".
    const card = page
      .locator("[data-slot='card']")
      .filter({ has: page.getByRole("button", { name: /Thứ/ }) })
      .first();

    const measure = async () => {
      await chips.nth(CHIP_INDEX).click();
      await expect(card).toBeVisible();
      await page.waitForTimeout(300);
      const box = await card.boundingBox();
      if (!box) throw new Error("khong do duoc the buoi choi");
      return {
        width: Math.round(box.width),
        wrappers: await page.locator(".led-border").count(),
      };
    };

    // Đèn BẬT: buổi đang vote.
    const on = await measure();
    expect(on.wrappers, "buổi đang vote phải có viền LED").toBe(1);

    // Đèn TẮT: cùng buổi đó, chuyển sang đã chốt sổ.
    await setStatus("completed");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(chips).toHaveCount(3, { timeout: 20_000 });
    const off = await measure();

    // Khẳng định CHIỀU NGANG trước: đây đúng là thứ người dùng nhìn thấy, và
    // khi hỏng thì thông báo nói thẳng lệch bao nhiêu pixel.
    expect(
      off.width,
      `chiều ngang thẻ: đèn bật ${on.width}px, đèn tắt ${off.width}px`,
    ).toBe(on.width);
    // Lớp bọc phải còn nguyên dù đèn đã tắt: đó là thứ giữ hai bên cùng cỡ.
    expect(off.wrappers, "buổi đã chốt vẫn phải giữ lớp bọc").toBe(1);
  });
});

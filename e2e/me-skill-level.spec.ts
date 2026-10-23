import { test, expect } from "@playwright/test";
import { createClient } from "@libsql/client";
import bcrypt from "bcryptjs";

/**
 * Member tự khai trình độ ở trang /me (yêu cầu 23/10/2026).
 *
 * Bài đi trọn vòng và ĐỌC THẲNG DB sau mỗi bước, chứ không chỉ nhìn màu trên
 * màn hình: khối này lưu ngay lúc bấm, không có nút Lưu, nên thứ duy nhất
 * chứng minh nó lưu thật là giá trị trong bảng members.
 */

test.use({ storageState: { cookies: [], origins: [] } });

const EMAIL = "e2eskill@example.com";
const PASSWORD = "skilllevel123";

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
      "SELECT id, name FROM members WHERE is_active=1 AND approval_status='approved' ORDER BY id LIMIT 1",
    )
  ).rows[0];
  memberId = Number(m.id);
  memberName = String(m.name);

  const hash = await bcrypt.hash(PASSWORD, 10);
  await c.execute({
    sql: "UPDATE members SET password_hash=?, email=?, skill_level=NULL WHERE id=?",
    args: [hash, EMAIL, memberId],
  });
  await c.execute("DELETE FROM rate_limit_buckets");
  c.close();
});

test.afterAll(async () => {
  const c = db();
  await c.execute("PRAGMA busy_timeout = 5000");
  await c.execute("UPDATE members SET skill_level=NULL WHERE id=?", [memberId]);
  c.close();
});

async function storedLevel(): Promise<string | null> {
  const c = db();
  await c.execute("PRAGMA busy_timeout = 5000");
  try {
    const r = await c.execute({
      sql: "SELECT skill_level FROM members WHERE id=?",
      args: [memberId],
    });
    const v = r.rows[0]?.skill_level;
    return v === null || v === undefined ? null : String(v);
  } finally {
    c.close();
  }
}

test.beforeEach(async ({ page }) => {
  await page.route(
    /connect\.facebook\.net|accounts\.google\.com|apis\.google\.com|gsi\//,
    (r) => r.abort(),
  );
});

test("chọn trình độ, lưu ngay, sống qua reload, bấm lại thì bỏ khai", async ({
  page,
}) => {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const identifier = page.getByPlaceholder("Username / SĐT / Email");
  await expect(identifier).toBeVisible({ timeout: 20_000 });
  await identifier.fill(EMAIL);
  await page.getByPlaceholder("Mật khẩu (≥ 8 ký tự)").fill(PASSWORD);
  await page.locator('button[type="submit"]').click();

  // Chờ rời hẳn /login trước khi đi tiếp. Điều hướng ngay sau khi bấm thì cú
  // chuyển trang của chính việc đăng nhập đá mình về trang chủ giữa chừng.
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), {
    timeout: 20_000,
  });

  await page.goto("/me", { waitUntil: "domcontentloaded" });

  // Khối gập lại mặc định, phải mở ra mới thấy năm mức.
  const header = page.getByRole("button", { name: /Trình độ/ });
  await expect(header).toBeVisible({ timeout: 20_000 });
  await header.click();

  // Khớp theo CÂU MÔ TẢ: tên ngắn "TB" là chuỗi con của cả "TBY" lẫn "TBK".
  const tby = page.getByRole("button", {
    name: /Trình bằng Yếu mà ảo tưởng hơn/,
  });
  const tbk = page.getByRole("button", { name: /Trung bình kém/ });

  await expect(tby).toBeVisible({ timeout: 20_000 });
  await expect(tby).toHaveAttribute("aria-pressed", "false");

  await tby.click();
  await expect(tby).toHaveAttribute("aria-pressed", "true");
  await expect.poll(storedLevel, { timeout: 10_000 }).toBe("tby");

  // Sống qua reload: đây là bằng chứng nó đọc lại từ DB chứ không chỉ là
  // state trên màn hình.
  await page.reload({ waitUntil: "domcontentloaded" });
  // Gập lại sau reload, nhưng mức đang khai phải hiện ngay trên thanh tiêu đề.
  await expect(page.getByRole("button", { name: /Trình độ.*TBY/ })).toBeVisible(
    {
      timeout: 20_000,
    },
  );
  await page.getByRole("button", { name: /Trình độ/ }).click();
  await expect(
    page.getByRole("button", { name: /Trình bằng Yếu mà ảo tưởng hơn/ }),
  ).toHaveAttribute("aria-pressed", "true");

  // Đổi sang mức khác.
  await tbk.click();
  await expect.poll(storedLevel, { timeout: 10_000 }).toBe("tbk");
  await expect(tby).toHaveAttribute("aria-pressed", "false");

  // Bấm lại đúng mức đang chọn thì bỏ khai.
  await tbk.click();
  await expect.poll(storedLevel, { timeout: 10_000 }).toBeNull();
  await expect(tbk).toHaveAttribute("aria-pressed", "false");
});

/** Ngày chơi gần nhất của tuần đích, dùng để dựng một buổi có danh sách vote. */
function targetFriday(): string {
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
  return vn(new Date(base.getTime() + (monOff + fromMon(5)) * 86_400_000));
}

test.describe("trình độ hiện ở trang chủ", () => {
  const DATE = targetFriday();

  test.beforeAll(async () => {
    const c = db();
    await c.execute("PRAGMA busy_timeout = 5000");
    const court = (await c.execute("SELECT id FROM courts LIMIT 1")).rows[0];
    await c.execute("DELETE FROM sessions WHERE date=?", [DATE]);
    const dl = new Date(Date.now() + 6 * 3600 * 1000);
    const p = (n: number) => String(n).padStart(2, "0");
    const deadline = `${dl.getFullYear()}-${p(dl.getMonth() + 1)}-${p(dl.getDate())}T${p(dl.getHours())}:${p(dl.getMinutes())}:${p(dl.getSeconds())}`;
    const ins = await c.execute({
      sql: `INSERT INTO sessions (date, start_time, end_time, court_id, court_quantity, court_price, status, vote_deadline)
            VALUES (?, '20:30', '22:30', ?, 1, 200000, 'voting', ?)`,
      args: [DATE, court?.id ?? null, deadline],
    });
    // Member đã vote → nằm ở danh sách "Đã vote", thấy ngay không cần mở gì.
    await c.execute({
      sql: `INSERT INTO votes (session_id, member_id, will_play, will_dine)
            VALUES (?, ?, 1, 0)`,
      args: [Number(ins.lastInsertRowid), memberId],
    });
    await c.execute("UPDATE members SET skill_level='tb' WHERE id=?", [
      memberId,
    ]);
    c.close();
  });

  test.afterAll(async () => {
    const c = db();
    await c.execute("PRAGMA busy_timeout = 5000");
    await c.execute("DELETE FROM sessions WHERE date=?", [DATE]);
    c.close();
  });

  test("nhãn trình độ nằm ngay cạnh tên member trong danh sách vote", async ({
    page,
  }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    const identifier = page.getByPlaceholder("Username / SĐT / Email");
    await expect(identifier).toBeVisible({ timeout: 20_000 });
    await identifier.fill(EMAIL);
    await page.getByPlaceholder("Mật khẩu (≥ 8 ký tự)").fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), {
      timeout: 20_000,
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Tìm ĐÚNG dòng của member này rồi mới tìm nhãn bên trong, chứ không tìm
    // chữ "TB" trên cả trang: chữ đó ngắn và dễ trùng với thứ khác.
    const row = page
      .locator("p", { hasText: new RegExp(memberName) })
      .filter({ hasText: "TB" })
      .first();
    await expect(row).toBeVisible({ timeout: 20_000 });

    // Bỏ khai thì nhãn phải biến mất, không để lại ô trống.
    const c = db();
    await c.execute("PRAGMA busy_timeout = 5000");
    await c.execute("UPDATE members SET skill_level=NULL WHERE id=?", [
      memberId,
    ]);
    c.close();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.locator("p", { hasText: new RegExp(memberName) }).first(),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.locator("p", { hasText: new RegExp(memberName) }).filter({
        hasText: "TB",
      }),
    ).toHaveCount(0);
  });
});

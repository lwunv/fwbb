import { test, expect, type Page } from "@playwright/test";
import { createClient, type Client } from "@libsql/client";
import bcrypt from "bcryptjs";

/**
 * Chuông thông báo (N1a). Ba bài:
 *  1. Công tắc `notificationsEnabled` tắt thì chuông không hiện (member + admin).
 *  2. Admin hủy buổi, member đã vote thấy chấm đỏ, mở sheet ở 390px, bấm tin
 *     thì sang /vote/{id} và chấm đỏ tắt.
 *  3. Member vote làm đầy buổi (sức chứa 1), chuông admin có tin sắp/đã đầy.
 *
 * Fixture chạy bằng SQL thô trên e2e/local.db. Buổi dùng ngày xa năm 2031 để
 * không lọt vào cửa sổ tuần của các spec khác (week-selector, adhoc-home).
 * Công tắc chỉ bật trong bài cần nó và luôn trả về giá trị cũ ở `finally`.
 */

const EMAIL = "e2ebell@example.com";
const PASSWORD = "bellpass123";
const DATE_CANCEL = "2031-03-04";
const DATE_CAPACITY = "2031-03-05";

async function db(): Promise<Client> {
  const c = createClient({ url: "file:e2e/local.db" });
  // Fixture và server Next mở CÙNG file, chờ lock nhả thay vì SQLITE_BUSY.
  await c.execute("PRAGMA busy_timeout = 5000");
  return c;
}

let memberId: number;
let saved: { email: string | null; hash: string | null };
let savedSwitch: string | null = null;

async function readSwitch(): Promise<string | null> {
  const c = await db();
  try {
    const r = await c.execute(
      "SELECT value FROM app_settings WHERE key = 'notificationsEnabled'",
    );
    return r.rows[0] ? String(r.rows[0].value) : null;
  } finally {
    c.close();
  }
}

/** `null` = xóa hàng (về mặc định tắt). */
async function writeSwitch(value: string | null) {
  const c = await db();
  try {
    if (value === null) {
      await c.execute(
        "DELETE FROM app_settings WHERE key = 'notificationsEnabled'",
      );
    } else {
      await c.execute({
        sql: "INSERT INTO app_settings (key, value) VALUES ('notificationsEnabled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        args: [value],
      });
    }
  } finally {
    c.close();
  }
}

async function cleanup(c: Client) {
  const ids = (
    await c.execute({
      sql: "SELECT id FROM sessions WHERE date IN (?, ?)",
      args: [DATE_CANCEL, DATE_CAPACITY],
    })
  ).rows.map((r) => Number(r.id));
  for (const id of ids) {
    await c.execute({
      sql: "DELETE FROM notifications WHERE entity_type = 'session' AND entity_id = ?",
      args: [id],
    });
    await c.execute({
      sql: "DELETE FROM votes WHERE session_id = ?",
      args: [id],
    });
  }
  await c.execute({
    sql: "DELETE FROM sessions WHERE date IN (?, ?)",
    args: [DATE_CANCEL, DATE_CAPACITY],
  });
}

async function seedSession(
  c: Client,
  date: string,
  maxPlayers: number,
): Promise<number> {
  const court = (await c.execute("SELECT id FROM courts LIMIT 1")).rows[0];
  const r = await c.execute({
    sql: `INSERT INTO sessions (date, start_time, end_time, court_id, court_quantity, court_price, status, max_players)
          VALUES (?, '20:30', '22:30', ?, 1, 200000, 'voting', ?) RETURNING id`,
    args: [date, court?.id ?? null, maxPlayers],
  });
  return Number(r.rows[0].id);
}

test.beforeAll(async () => {
  savedSwitch = await readSwitch();
  const c = await db();
  try {
    const m = (
      await c.execute(
        "SELECT id, email, password_hash FROM members WHERE is_active=1 AND approval_status='approved' ORDER BY id LIMIT 1",
      )
    ).rows[0];
    memberId = Number(m.id);
    saved = {
      email: m.email === null ? null : String(m.email),
      hash: m.password_hash === null ? null : String(m.password_hash),
    };
    // Email là UNIQUE: gỡ khỏi member khác (do lần chạy cũ) trước khi gán.
    await c.execute({
      sql: "UPDATE members SET email = NULL WHERE email = ?",
      args: [EMAIL],
    });
    await c.execute({
      sql: "UPDATE members SET password_hash = ?, email = ? WHERE id = ?",
      args: [await bcrypt.hash(PASSWORD, 10), EMAIL, memberId],
    });
    await c.execute("DELETE FROM rate_limit_buckets");
    await cleanup(c);
  } finally {
    c.close();
  }
});

test.afterAll(async () => {
  const c = await db();
  try {
    await cleanup(c);
    await c.execute({
      sql: "UPDATE members SET email = ?, password_hash = ? WHERE id = ?",
      args: [saved.email, saved.hash, memberId],
    });
  } finally {
    c.close();
  }
  await writeSwitch(savedSwitch);
});

test.beforeEach(async ({ page }) => {
  // Chặn SDK ngoài để form đăng nhập email/mật khẩu hiện ngay.
  await page.route(
    /connect\.facebook\.net|accounts\.google\.com|apis\.google\.com|gsi\//,
    (r) => r.abort(),
  );
});

async function loginMember(page: Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const identifier = page.getByPlaceholder("Username / SĐT / Email");
  await expect(identifier).toBeVisible({ timeout: 20_000 });
  await identifier.fill(EMAIL);
  await page.getByPlaceholder("Mật khẩu (≥ 8 ký tự)").fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), {
    timeout: 20_000,
  });
}

const bellButton = (page: Page, name: RegExp | string) =>
  page.getByRole("button", { name }).first();

test("bell hidden while notificationsEnabled is off", async ({
  browser,
  page,
}) => {
  await writeSwitch(null);

  // Admin (storageState mặc định).
  await page.goto("/admin/dashboard", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Admin").first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("button", { name: /^Thông báo/ })).toHaveCount(0);

  // Member.
  const ctx = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const mp = await ctx.newPage();
  await mp.route(
    /connect\.facebook\.net|accounts\.google\.com|apis\.google\.com|gsi\//,
    (r) => r.abort(),
  );
  await loginMember(mp);
  await mp.goto("/me", { waitUntil: "domcontentloaded" });
  await expect(mp.getByRole("button", { name: /Trình độ/ })).toBeVisible({
    timeout: 20_000,
  });
  await expect(mp.getByRole("button", { name: /^Thông báo/ })).toHaveCount(0);
  await ctx.close();
});

test("admin cancels a session; voter sees unread badge, opens sheet at 390px, taps the row, lands on /vote/{id}, badge clears", async ({
  browser,
  page,
}) => {
  const c = await db();
  let sessionId: number;
  try {
    sessionId = await seedSession(c, DATE_CANCEL, 16);
    await c.execute({
      sql: "INSERT INTO votes (session_id, member_id, will_play) VALUES (?, ?, 1)",
      args: [sessionId, memberId],
    });
  } finally {
    c.close();
  }

  const ctx = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    viewport: { width: 390, height: 844 },
  });
  const mp = await ctx.newPage();
  await mp.route(
    /connect\.facebook\.net|accounts\.google\.com|apis\.google\.com|gsi\//,
    (r) => r.abort(),
  );
  try {
    await writeSwitch("true");
    await loginMember(mp);

    // Admin hủy buổi bằng nút thật trên trang chi tiết.
    await page.goto(`/admin/sessions/${sessionId}`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("button", { name: "Hủy", exact: true }).click();
    await page.getByRole("button", { name: "Xác nhận", exact: true }).click();

    // Bản ghi tin phải nằm trong DB trước khi member tải lại trang.
    await expect
      .poll(
        async () => {
          const q = await db();
          try {
            const r = await q.execute({
              sql: "SELECT count(*) AS n FROM notifications WHERE kind = 'session_cancelled' AND entity_id = ? AND recipient_type = 'member' AND recipient_id = ?",
              args: [sessionId, memberId],
            });
            return Number(r.rows[0].n);
          } finally {
            q.close();
          }
        },
        { timeout: 20_000 },
      )
      .toBe(1);

    await mp.goto("/me", { waitUntil: "domcontentloaded" });
    const bell = bellButton(mp, /^Thông báo, 1 chưa đọc/);
    await expect(bell).toBeVisible({ timeout: 20_000 });
    const box = await bell.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);

    await bell.click();
    const row = mp.getByRole("button", { name: /Buổi chơi bị hủy/ }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    // Sheet bám đáy màn hình 390px, không tràn ngang.
    const sheet = mp.getByRole("dialog");
    const sb = await sheet.boundingBox();
    expect(sb!.width).toBeLessThanOrEqual(390);
    expect(sb!.y + sb!.height).toBeGreaterThan(800);

    await row.click();
    await mp.waitForURL(`**/vote/${sessionId}`, { timeout: 20_000 });
    await expect(
      mp.getByRole("button", { name: /^Thông báo$/ }).first(),
    ).toBeVisible({ timeout: 20_000 });
    await expect(mp.getByRole("button", { name: /chưa đọc/ })).toHaveCount(0);
  } finally {
    await ctx.close();
    await writeSwitch(savedSwitch);
  }
});

test("admin bell lists a capacity alert after a seeded vote fills the session", async ({
  browser,
  page,
}) => {
  const c = await db();
  let sessionId: number;
  try {
    // Sức chứa 1: một người vote chơi là buổi đầy (bậc 2).
    sessionId = await seedSession(c, DATE_CAPACITY, 1);
  } finally {
    c.close();
  }

  const ctx = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const mp = await ctx.newPage();
  await mp.route(
    /connect\.facebook\.net|accounts\.google\.com|apis\.google\.com|gsi\//,
    (r) => r.abort(),
  );
  try {
    await writeSwitch("true");
    await loginMember(mp);
    await mp.goto(`/vote/${sessionId}`, { waitUntil: "domcontentloaded" });
    await mp
      .getByRole("button", { name: /^Cầu lông/ })
      .first()
      .click();

    await expect
      .poll(
        async () => {
          const q = await db();
          try {
            const r = await q.execute({
              sql: "SELECT count(*) AS n FROM notifications WHERE kind = 'capacity_alert' AND entity_id = ? AND recipient_type = 'admin'",
              args: [sessionId],
            });
            return Number(r.rows[0].n);
          } finally {
            q.close();
          }
        },
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);

    await page.goto("/admin/dashboard", { waitUntil: "domcontentloaded" });
    const bell = page.getByRole("button", { name: /^Thông báo/ }).first();
    await expect(bell).toBeVisible({ timeout: 20_000 });
    await bell.click();
    await expect(page.getByText(/Buổi đã đầy chỗ/).first()).toBeVisible({
      timeout: 15_000,
    });
  } finally {
    await ctx.close();
    await writeSwitch(savedSwitch);
  }
});

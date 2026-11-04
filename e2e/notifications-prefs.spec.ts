import { test, expect, type Page } from "@playwright/test";
import { createClient, type Client } from "@libsql/client";
import bcrypt from "bcryptjs";

/**
 * Tuỳ chọn thông báo (N1b). Hai bài:
 *  1. Member tắt nhóm "Buổi chơi" ở /me, công tắc giữ nguyên sau khi tải lại và
 *     DB ghi đúng nhóm đã tắt.
 *  2. Trang /huy-nhan-thong-bao: GET chỉ hiện nút và không đổi gì, bấm nút mới
 *     tắt email.
 *
 * Fixture bằng SQL thô trên e2e/local.db. Công tắc `notificationsEnabled` chỉ
 * bật trong bài cần nó và luôn trả về giá trị cũ. Chọn member id nhỏ nhất KHÔNG
 * bị buộc đổi mật khẩu: member có mật khẩu tạm chỉ thấy form đổi mật khẩu thay
 * cho mọi trang, nên không mở được thẻ Thông báo ở /me.
 */

const EMAIL = "e2eprefs@example.com";
const PASSWORD = "prefspass123";
// 43 ký tự base64url, đúng dạng route huỷ nhận kiểm.
const UNSUB_TOKEN = "e2ePrefsUnsubToken".padEnd(43, "A");

async function db(): Promise<Client> {
  const c = createClient({ url: "file:e2e/local.db" });
  // Fixture và server Next mở CÙNG file, chờ lock nhả thay vì SQLITE_BUSY.
  await c.execute("PRAGMA busy_timeout = 5000");
  return c;
}

let memberId: number;
let saved: { email: string | null; hash: string | null };
let savedSwitch: string | null = null;
let savedPrefs: Record<string, unknown> | null = null;

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

async function readPrefs(c: Client) {
  return (
    await c.execute({
      sql: "SELECT muted_groups, email_enabled, unsub_token FROM notification_prefs WHERE recipient_type = 'member' AND recipient_id = ?",
      args: [memberId],
    })
  ).rows[0];
}

async function clearPrefs(c: Client) {
  await c.execute({
    sql: "DELETE FROM notification_prefs WHERE recipient_type = 'member' AND recipient_id = ?",
    args: [memberId],
  });
}

test.beforeAll(async () => {
  savedSwitch = await readSwitch();
  const c = await db();
  try {
    const m = (
      await c.execute(
        "SELECT id, email, password_hash FROM members WHERE is_active=1 AND approval_status='approved' AND must_change_password=0 ORDER BY id LIMIT 1",
      )
    ).rows[0];
    memberId = Number(m.id);
    saved = {
      email: m.email === null ? null : String(m.email),
      hash: m.password_hash === null ? null : String(m.password_hash),
    };
    const p = await readPrefs(c);
    savedPrefs = p ? { ...p } : null;
    await clearPrefs(c);
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
  } finally {
    c.close();
  }
});

test.afterAll(async () => {
  const c = await db();
  try {
    await clearPrefs(c);
    if (savedPrefs) {
      await c.execute({
        sql: "INSERT INTO notification_prefs (recipient_type, recipient_id, muted_groups, email_enabled, unsub_token, updated_at) VALUES ('member', ?, ?, ?, ?, ?)",
        args: [
          memberId,
          String(savedPrefs.muted_groups),
          Number(savedPrefs.email_enabled),
          savedPrefs.unsub_token === null
            ? null
            : String(savedPrefs.unsub_token),
          new Date().toISOString(),
        ],
      });
    }
    await c.execute({
      sql: "UPDATE members SET email = ?, password_hash = ? WHERE id = ?",
      args: [saved.email, saved.hash, memberId],
    });
  } finally {
    c.close();
  }
  await writeSwitch(savedSwitch);
});

async function loginMember(page: Page) {
  await page.route(
    /connect\.facebook\.net|accounts\.google\.com|apis\.google\.com|gsi\//,
    (r) => r.abort(),
  );
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

async function openPrefs(page: Page) {
  await page.goto("/me", { waitUntil: "domcontentloaded" });
  const header = page.locator("button[aria-expanded]", {
    hasText: "Thông báo",
  });
  await expect(header).toBeVisible({ timeout: 20_000 });
  if ((await header.getAttribute("aria-expanded")) !== "true") {
    await header.click();
  }
}

test("member mutes the session group in /me and the toggle survives reload", async ({
  browser,
}) => {
  const ctx = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    viewport: { width: 390, height: 844 },
  });
  const page = await ctx.newPage();
  try {
    await writeSwitch("true");
    await loginMember(page);
    await openPrefs(page);

    const toggle = page.getByRole("switch", { name: "Buổi chơi", exact: true });
    await expect(toggle).toBeVisible({ timeout: 20_000 });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();

    // Bản ghi phải nằm trong DB trước khi tải lại trang.
    await expect
      .poll(
        async () => {
          const q = await db();
          try {
            const r = await readPrefs(q);
            return r ? String(r.muted_groups) : "";
          } finally {
            q.close();
          }
        },
        { timeout: 20_000 },
      )
      .toContain("session");

    await openPrefs(page);
    const after = page.getByRole("switch", { name: "Buổi chơi", exact: true });
    await expect(after).toBeVisible({ timeout: 20_000 });
    await expect(after).not.toBeChecked();
    // Nhóm bắt buộc (Tài khoản) vẫn khoá và bật.
    const account = page.getByRole("switch", {
      name: "Tài khoản",
      exact: true,
    });
    await expect(account).toBeChecked();
    await expect(account).toBeDisabled();
  } finally {
    await ctx.close();
    await writeSwitch(savedSwitch);
  }
});

test("unsubscribe page GET shows a button and changes nothing until pressed", async ({
  browser,
}) => {
  const c = await db();
  try {
    await clearPrefs(c);
    await c.execute({
      sql: "INSERT INTO notification_prefs (recipient_type, recipient_id, muted_groups, email_enabled, unsub_token, updated_at) VALUES ('member', ?, '[]', 1, ?, ?)",
      args: [memberId, UNSUB_TOKEN, new Date().toISOString()],
    });
  } finally {
    c.close();
  }

  // Trang công khai: không cần đăng nhập và không cần bật công tắc.
  const ctx = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    viewport: { width: 390, height: 844 },
  });
  const page = await ctx.newPage();
  const emailEnabled = async () => {
    const q = await db();
    try {
      const r = await readPrefs(q);
      return Number(r?.email_enabled);
    } finally {
      q.close();
    }
  };
  try {
    await page.goto(`/huy-nhan-thong-bao?token=${UNSUB_TOKEN}`, {
      waitUntil: "domcontentloaded",
    });
    const button = page.getByRole("button", { name: "Ngừng nhận email" });
    await expect(button).toBeVisible({ timeout: 20_000 });
    const box = await button.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    // Mở trang (GET) và GET thẳng vào API (như máy quét link) đều không đổi gì.
    // GET vào API chuyển sang trang xác nhận thay vì trang trắng 405.
    expect(await emailEnabled()).toBe(1);
    const get = await page.request.get(
      `/api/notifications/unsubscribe?token=${UNSUB_TOKEN}`,
      { maxRedirects: 0 },
    );
    expect(get.status()).toBe(303);
    expect(get.headers()["location"]).toContain(
      `/huy-nhan-thong-bao?token=${UNSUB_TOKEN}`,
    );
    expect(await emailEnabled()).toBe(1);

    await button.click();
    await expect(
      page.getByRole("heading", { name: "Đã ngừng nhận email" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect.poll(emailEnabled, { timeout: 20_000 }).toBe(0);
  } finally {
    await ctx.close();
  }
});

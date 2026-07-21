import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@libsql/client";
import bcrypt from "bcryptjs";
import { createHash } from "crypto";

/**
 * E2E cho luồng forgot/reset mật khẩu tự phục vụ (token qua email) + admin tạo
 * member kèm mail mời đặt mật khẩu. Khác với reset-password.spec.ts (mật khẩu
 * TẠM do admin reset tại gate /login) — spec này test bảng
 * `password_reset_tokens` + route `/reset-password/[token]`, `/forgot-password`,
 * `/admin-forgot-password`.
 *
 * DB: file e2e/local.db (webServer trỏ vào, KHÔNG đụng prod). local.db là bản
 * clone cũ hơn migration 0022 → bảng password_reset_tokens chưa tồn tại, nên
 * beforeAll tự áp DDL (idempotent, chỉ file local) trước khi seed.
 *
 * Token raw KHÔNG BAO GIỜ được lưu trong DB (chỉ sha256 hash) — để test được
 * trang reset, spec tự sinh 1 raw token biết trước, tự hash (sha256, đồng nhất
 * với src/lib/password-reset-token.ts#hashResetToken) rồi insert thẳng vào DB.
 */

test.use({ storageState: { cookies: [], origins: [] } });

// Chặn SDK OAuth ngoài → gate fallback về form email/mật khẩu (deterministic),
// giống pattern auth-password.spec.ts / reset-password.spec.ts.
test.beforeEach(async ({ page }) => {
  await page.route(
    /connect\.facebook\.net|accounts\.google\.com|apis\.google\.com|gsi\//,
    (r) => r.abort(),
  );
});

function db() {
  return createClient({ url: "file:e2e/local.db" });
}

/** sha256 hex — bản sao thuần của hashResetToken() (spec không import từ src/
 *  để tránh phụ thuộc alias "@/" trong Playwright TS runtime). */
function hashResetToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

const RUN_ID = Date.now();
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

test.beforeAll(async () => {
  const c = db();
  // Migration 0022 (password_reset_tokens) — local.db clone cũ hơn migration
  // này nên chưa có bảng; áp DDL y hệt src/db/migrations/0022_needy_pepper_potts.sql.
  await c.execute(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      member_id integer,
      admin_id integer,
      token_hash text NOT NULL,
      expires_at text NOT NULL,
      used_at text,
      created_at text DEFAULT (current_timestamp),
      FOREIGN KEY (member_id) REFERENCES members(id) ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY (admin_id) REFERENCES admins(id) ON UPDATE no action ON DELETE cascade
    )
  `);
  await c.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS prt_token_hash_unique ON password_reset_tokens (token_hash)",
  );
  // Reset rate-limit để cả suite (nhiều request liên tiếp) không bị chặn.
  await c.execute("DELETE FROM rate_limit_buckets").catch(() => {});
  c.close();
});

async function insertMember(opts: {
  name: string;
  email: string;
  passwordHash: string;
}): Promise<number> {
  const c = db();
  await c.execute({
    sql: `INSERT INTO members
      (name, email, password_hash, approval_status, is_active, default_with_partner)
      VALUES (?, ?, ?, 'approved', 1, 0)`,
    args: [opts.name, opts.email, opts.passwordHash],
  });
  const r = await c.execute({
    sql: "SELECT id FROM members WHERE email = ?",
    args: [opts.email],
  });
  c.close();
  return Number(r.rows[0].id);
}

async function insertAdmin(opts: {
  username: string;
  email: string;
  passwordHash: string;
}): Promise<number> {
  const c = db();
  await c.execute({
    sql: `INSERT INTO admins (username, email, password_hash) VALUES (?, ?, ?)`,
    args: [opts.username, opts.email, opts.passwordHash],
  });
  const r = await c.execute({
    sql: "SELECT id FROM admins WHERE email = ?",
    args: [opts.email],
  });
  c.close();
  return Number(r.rows[0].id);
}

async function insertResetToken(opts: {
  memberId?: number;
  adminId?: number;
  tokenHash: string;
  expiresAt: string;
}) {
  const c = db();
  await c.execute({
    sql: `INSERT INTO password_reset_tokens (member_id, admin_id, token_hash, expires_at)
      VALUES (?, ?, ?, ?)`,
    args: [
      opts.memberId ?? null,
      opts.adminId ?? null,
      opts.tokenHash,
      opts.expiresAt,
    ],
  });
  c.close();
}

async function fillNeutralForgotForm(page: Page, email: string) {
  await page.locator('input[type="email"]').fill(email);
  await page.locator('button[type="submit"]').click();
}

test.describe("quên mật khẩu → đặt lại qua token (e2e)", () => {
  test("mở link reset hợp lệ → đặt mật khẩu mới → hash đổi + token dùng 1 lần", async ({
    page,
  }) => {
    const email = `e2e-fp-reset-${RUN_ID}@example.com`;
    const oldHash = bcrypt.hashSync("OldPassword123", 12);
    const memberId = await insertMember({
      name: "E2E FP Reset",
      email,
      passwordHash: oldHash,
    });

    const rawToken = `e2e-known-raw-${RUN_ID}`;
    const tokenHash = hashResetToken(rawToken);
    await insertResetToken({ memberId, tokenHash, expiresAt: FUTURE });

    await page.goto(`/reset-password/${rawToken}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: "Đặt mật khẩu mới" }),
    ).toBeVisible({ timeout: 15_000 });

    const NEW_PW = "FreshResetPass123";
    await page.getByPlaceholder("Mật khẩu mới (≥ 8 ký tự)").fill(NEW_PW);
    await page.getByPlaceholder("Xác nhận mật khẩu mới").fill(NEW_PW);
    await page.getByRole("button", { name: "Đổi mật khẩu" }).click();

    // Reset thành công (member) → cookie đã bị xóa server-side + điều hướng về
    // "/" (login gate) — form reset biến mất khỏi trang.
    await expect(
      page.getByRole("heading", { name: "Đặt mật khẩu mới" }),
    ).toHaveCount(0, { timeout: 15_000 });
    await expect(page).toHaveURL(/\/$/);

    const c = db();
    const memberRow = await c.execute({
      sql: "SELECT password_hash FROM members WHERE id = ?",
      args: [memberId],
    });
    const tokenRow = await c.execute({
      sql: "SELECT used_at FROM password_reset_tokens WHERE token_hash = ?",
      args: [tokenHash],
    });
    c.close();

    const newHash = String(memberRow.rows[0].password_hash);
    expect(newHash).not.toBe(oldHash);
    expect(bcrypt.compareSync(NEW_PW, newHash)).toBe(true);
    expect(tokenRow.rows[0].used_at).not.toBeNull();
  });

  test("token không hợp lệ/không tồn tại → màn hình hết hạn + link gửi lại", async ({
    page,
  }) => {
    await page.goto("/reset-password/bogus-token-does-not-exist", {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: "Link đã hết hạn" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/không hợp lệ hoặc đã hết hạn/i)).toBeVisible();
    const link = page.getByRole("link", { name: "Gửi lại link" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/forgot-password");
  });

  test("member quên mật khẩu → thông báo trung tính + token được tạo", async ({
    page,
  }) => {
    const email = `e2e-fp-forgot-${RUN_ID}@example.com`;
    const memberId = await insertMember({
      name: "E2E FP Forgot",
      email,
      passwordHash: bcrypt.hashSync("Whatever123", 12),
    });

    await page.goto("/forgot-password", { waitUntil: "domcontentloaded" });
    await expect(page.locator('input[type="email"]')).toBeVisible({
      timeout: 15_000,
    });
    await fillNeutralForgotForm(page, email);

    await expect(
      page.getByText(
        "Nếu email tồn tại trong hệ thống, chúng tôi đã gửi email hướng dẫn đặt lại mật khẩu.",
      ),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('input[type="email"]')).toHaveCount(0);
    const backLink = page.getByRole("link", { name: "Quay lại đăng nhập" });
    await expect(backLink).toHaveAttribute("href", "/login");

    await expect
      .poll(
        async () => {
          const c = db();
          const r = await c.execute({
            sql: "SELECT COUNT(*) AS n FROM password_reset_tokens WHERE member_id = ?",
            args: [memberId],
          });
          c.close();
          return Number(r.rows[0].n);
        },
        { timeout: 10_000, intervals: [300, 500, 800] },
      )
      .toBeGreaterThanOrEqual(1);
  });

  test("admin quên mật khẩu → thông báo trung tính + token được tạo", async ({
    page,
  }) => {
    const email = `e2e-fp-admin-${RUN_ID}@example.com`;
    const adminId = await insertAdmin({
      username: `e2efpadmin${RUN_ID}`,
      email,
      passwordHash: bcrypt.hashSync("Whatever123", 12),
    });

    await page.goto("/admin-forgot-password", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator('input[type="email"]')).toBeVisible({
      timeout: 15_000,
    });
    await fillNeutralForgotForm(page, email);

    await expect(
      page.getByText(
        "Nếu email tồn tại trong hệ thống, chúng tôi đã gửi email hướng dẫn đặt lại mật khẩu.",
      ),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('input[type="email"]')).toHaveCount(0);
    const backLink = page.getByRole("link", { name: "Quay lại đăng nhập" });
    await expect(backLink).toHaveAttribute("href", "/admin/login");

    await expect
      .poll(
        async () => {
          const c = db();
          const r = await c.execute({
            sql: "SELECT COUNT(*) AS n FROM password_reset_tokens WHERE admin_id = ?",
            args: [adminId],
          });
          c.close();
          return Number(r.rows[0].n);
        },
        { timeout: 10_000, intervals: [300, 500, 800] },
      )
      .toBeGreaterThanOrEqual(1);
  });
});

test.describe("admin tạo member kèm mail mời đặt mật khẩu (e2e)", () => {
  // Ghi đè lại storageState admin (khác file-level logged-out ở trên) — tạo
  // member là thao tác admin, chạy dưới session đã login (project chromium).
  test.use({ storageState: "e2e/.auth/admin.json" });

  test("tick 'gửi mail mời' khi tạo member có email → token invite xuất hiện trong DB", async ({
    page,
  }) => {
    const name = `E2E FP Invite ${RUN_ID}`;
    const email = `e2e-fp-invite-${RUN_ID}@example.com`;

    await page.goto("/admin/members", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Thêm thành viên" }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator("#name").fill(name);
    await dialog.locator("#email").fill(email);
    await dialog.locator('input[name="sendInvite"]').check();
    await dialog.locator('button[type="submit"]').click();

    await expect
      .poll(
        async () => {
          const c = db();
          const r = await c.execute({
            sql: `SELECT COUNT(*) AS n FROM password_reset_tokens pt
              JOIN members m ON m.id = pt.member_id
              WHERE m.email = ?`,
            args: [email],
          });
          c.close();
          return Number(r.rows[0].n);
        },
        { timeout: 10_000, intervals: [300, 500, 800] },
      )
      .toBeGreaterThanOrEqual(1);
  });
});

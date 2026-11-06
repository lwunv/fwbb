import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@libsql/client";
import bcrypt from "bcryptjs";

// Link /vote/[id] (admin hay gửi vào nhóm) phải chặn member nợ quá hạn mức
// giống trang chủ. Spec 2026-11-06-debt-vote-block-design.md mục 4.2.
test.use({ storageState: { cookies: [], origins: [] } });

const EMAIL = "e2e-vote-debt@example.com";
const PASSWORD = "votedebt12345";
const TEST_DATE = "2099-07-01";
const DEBT_KEY = "e2e-vote-debt-block";

async function db() {
  const c = createClient({ url: "file:e2e/local.db" });
  await c.execute("PRAGMA busy_timeout = 5000");
  return c;
}

let sessionId: number;
let memberId: number;

async function clearDebt() {
  const c = await db();
  await c.execute({
    sql: "DELETE FROM financial_transactions WHERE idempotency_key = ?",
    args: [DEBT_KEY],
  });
  c.close();
}

/** Đặt số dư member về đúng `balance` bằng một dòng sổ riêng của bài test. */
async function setBalance(balance: number) {
  await clearDebt();
  const c = await db();
  const rows = (
    await c.execute({
      sql: "SELECT type, amount FROM financial_transactions WHERE member_id = ?",
      args: [memberId],
    })
  ).rows;
  // Không tự tính lại sổ ở đây: chỉ cần member nợ thật sâu hoặc không nợ.
  // Số dư hiện có của member seed được bù bằng 1 dòng điều chỉnh.
  const current = rows.reduce((s, r) => {
    const amt = Number(r.amount);
    return r.type === "fund_contribution"
      ? s + amt
      : r.type === "fund_deduction" || r.type === "fund_refund"
        ? s - amt
        : s;
  }, 0);
  const delta = balance - current;
  if (delta !== 0) {
    await c.execute({
      sql: "INSERT INTO financial_transactions (type, direction, amount, member_id, idempotency_key, description) VALUES (?, ?, ?, ?, ?, 'e2e')",
      args: [
        delta > 0 ? "fund_contribution" : "fund_deduction",
        delta > 0 ? "in" : "out",
        Math.abs(delta),
        memberId,
        DEBT_KEY,
      ],
    });
  }
  c.close();
}

test.beforeAll(async () => {
  const c = await db();
  const m = (
    await c.execute(
      "SELECT id FROM members WHERE is_active=1 AND approval_status='approved' ORDER BY id DESC LIMIT 1",
    )
  ).rows[0];
  memberId = Number(m.id);
  const hash = await bcrypt.hash(PASSWORD, 10);
  await c.execute({
    sql: "UPDATE members SET email = NULL WHERE email = ?",
    args: [EMAIL],
  });
  await c.execute({
    sql: "UPDATE members SET password_hash=?, email=? WHERE id=?",
    args: [hash, EMAIL, memberId],
  });
  await c.execute("DELETE FROM rate_limit_buckets");
  await c.execute({
    sql: "DELETE FROM sessions WHERE date=?",
    args: [TEST_DATE],
  });
  const inserted = await c.execute({
    sql: "INSERT INTO sessions (date, status) VALUES (?, 'voting')",
    args: [TEST_DATE],
  });
  sessionId = Number(inserted.lastInsertRowid);
  c.close();
});

test.afterAll(async () => {
  await clearDebt();
  const c = await db();
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

test.beforeEach(async ({ page }) => {
  await page.route(
    /connect\.facebook\.net|accounts\.google\.com|apis\.google\.com|gsi\//,
    (r) => r.abort(),
  );
});

async function loginAsMember(page: Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const identifier = page.getByPlaceholder("Username / SĐT / Email");
  await expect(identifier).toBeVisible({ timeout: 20_000 });
  await identifier.fill(EMAIL);
  await page.getByPlaceholder("Mật khẩu (≥ 8 ký tự)").fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(identifier).toHaveCount(0, { timeout: 15_000 });
}

const stickyVoteBar = (page: Page) => page.locator("div.fixed.bottom-0.z-40");

test.describe("link vote khi nợ quá hạn mức", () => {
  test("nợ 188.000 → thấy câu báo nợ, không có thanh vote", async ({
    page,
  }) => {
    await setBalance(-188_000);
    await loginAsMember(page);
    await page.goto(`/vote/${sessionId}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("nên chưa vote được")).toBeVisible({
      timeout: 15_000,
    });
    await expect(stickyVoteBar(page)).toHaveCount(0);
  });

  test("không nợ → thanh vote vẫn hiện như cũ", async ({ page }) => {
    await setBalance(50_000);
    await loginAsMember(page);
    await page.goto(`/vote/${sessionId}`, { waitUntil: "domcontentloaded" });
    await expect(stickyVoteBar(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("nên chưa vote được")).toHaveCount(0);
  });
});

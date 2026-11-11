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

/** Đặt số dư member về đúng `balance` (member riêng của bài, sổ trống). */
async function setBalance(balance: number) {
  await clearDebt();
  if (balance === 0) return;
  const c = await db();
  await c.execute({
    sql: "INSERT INTO financial_transactions (type, direction, amount, member_id, idempotency_key, description) VALUES (?, ?, ?, ?, ?, 'e2e')",
    args: [
      balance > 0 ? "fund_contribution" : "fund_deduction",
      balance > 0 ? "in" : "out",
      Math.abs(balance),
      memberId,
      DEBT_KEY,
    ],
  });
  c.close();
}

async function removeOwnMember(c: Awaited<ReturnType<typeof db>>) {
  await c.execute({
    sql: "DELETE FROM votes WHERE member_id IN (SELECT id FROM members WHERE email = ?)",
    args: [EMAIL],
  });
  await c.execute({
    sql: "DELETE FROM financial_transactions WHERE member_id IN (SELECT id FROM members WHERE email = ?)",
    args: [EMAIL],
  });
  await c.execute({
    sql: "DELETE FROM members WHERE email = ?",
    args: [EMAIL],
  });
}

// Member RIÊNG của bài (không mượn member seed): bài khác có thể khoá, đổi
// mật khẩu hay gắn nợ cho member seed, làm bài này đăng nhập hỏng khi chạy
// chung cả bộ (dính 6/11/2026).
test.beforeAll(async () => {
  const c = await db();
  await removeOwnMember(c);
  const hash = await bcrypt.hash(PASSWORD, 10);
  const m = await c.execute({
    sql: "INSERT INTO members (name, email, password_hash, is_active, approval_status) VALUES ('E2E Nợ Quỹ', ?, ?, 1, 'approved')",
    args: [EMAIL, hash],
  });
  memberId = Number(m.lastInsertRowid);
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
  const c = await db();
  await removeOwnMember(c);
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

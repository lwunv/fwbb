import { test, expect } from "@playwright/test";
import { createClient } from "@libsql/client";
import bcrypt from "bcryptjs";

/**
 * Bug user báo 21/9/2026: ở /me, focus vào ô nhập thì viền sáng bị "lẹm" hai bên.
 *
 * Nguyên nhân: khối "sửa thông tin" gập/mở bằng animation chiều cao nên phải
 * `overflow-hidden`, mà vòng focus của input (`focus-visible:ring-3`) vẽ 3px RA
 * NGOÀI khung. Trên dưới không lộ vì form có padding dọc; trái phải sát mép nên
 * bị cắt.
 *
 * Test này KHÔNG chụp ảnh so sánh (dễ vỡ vặt). Nó đo hình học: mép ô nhập phải
 * nằm cách mép cắt của khối cha ít nhất bằng bề dày vòng sáng. Đó đúng là điều
 * kiện để vòng sáng hiện đủ, và nó sai trước khi vá.
 */

test.use({ storageState: { cookies: [], origins: [] } });

const EMAIL = "e2ering@example.com";
const PASSWORD = "focusring123";
/** Khớp `focus-visible:ring-3` trên `src/components/ui/input.tsx`. */
const RING_PX = 3;

test.beforeAll(async () => {
  const c = createClient({ url: "file:e2e/local.db" });
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
  await c.execute("DELETE FROM rate_limit_buckets");
  c.close();
});

test("ô nhập ở /me không bị khối gập cắt mất viền focus", async ({ page }) => {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  // Mode mặc định = login: ô định danh đa kênh, KHÔNG phải input[type=email]
  // (cái đó chỉ có ở mode đăng ký). Chép đúng cách week-selector.spec.ts dùng.
  const identifier = page.getByPlaceholder("Username / SĐT / Email");
  await expect(identifier).toBeVisible({ timeout: 20_000 });
  await identifier.fill(EMAIL);
  await page.getByPlaceholder("Mật khẩu (≥ 8 ký tự)").fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), {
    timeout: 20_000,
  });

  await page.goto("/me", { waitUntil: "domcontentloaded" });

  // Mở khối "sửa thông tin" — ô biệt danh nằm trong đó.
  const nickname = page.locator("#me-nickname");
  if (!(await nickname.isVisible().catch(() => false))) {
    await page
      .getByText(/Sửa thông tin|Biệt danh/)
      .first()
      .click();
  }
  await expect(nickname).toBeVisible({ timeout: 10_000 });
  await nickname.focus();

  // Đo: tìm tổ tiên GẦN NHẤT thật sự cắt theo trục ngang, rồi so mép.
  const geom = await nickname.evaluate((el, ring) => {
    let node = el.parentElement;
    while (node) {
      const ox = getComputedStyle(node).overflowX;
      if (ox !== "visible") break;
      node = node.parentElement;
    }
    if (!node) return null;
    const a = el.getBoundingClientRect();
    const b = node.getBoundingClientRect();
    return {
      leftGap: a.left - b.left,
      rightGap: b.right - a.right,
      ring,
    };
  }, RING_PX);

  expect(geom, "phải có tổ tiên cắt tràn để phép đo có nghĩa").not.toBeNull();
  // Trước khi vá, hai khoảng này bằng 0 → vòng 3px bị cắt sạch hai bên.
  expect(geom!.leftGap).toBeGreaterThanOrEqual(RING_PX);
  expect(geom!.rightGap).toBeGreaterThanOrEqual(RING_PX);
});

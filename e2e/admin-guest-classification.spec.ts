import { test, expect } from "@playwright/test";
import { createClient } from "@libsql/client";

// Ngày xa tương lai, không đụng session thật/session của bài test khác
// (vote-contact.spec.ts đã chiếm "2099-06-01").
const TEST_DATE = "2099-06-15";
// Court + shuttlecock = 0 → totalPlayCost = courtPrice, dễ tính tay.
const COURT_PRICE = 150_000;

async function db() {
  const c = createClient({ url: "file:e2e/local.db" });
  // Fixture và server Next mở CÙNG file e2e/local.db, nên ghi đồng thời làm
  // SQLITE_BUSY. Chờ lock nhả thay vì chết ngay. Cùng cách src/db/test-db.ts
  // đã dùng cho test tích hợp.
  await c.execute("PRAGMA busy_timeout = 5000");
  return c;
}

let sessionId: number;
let adminMemberId: number;
let otherMemberId: number;

/**
 * `groupPolicies` với `guestMember` KHÁC HẲN `guestAdmin` (fixed 15K so với
 * floor 60K mặc định) — cố tình để phân loại sai/đúng ra 2 con số rõ rệt.
 * Object phải đủ TRỌN 6 nhóm (schema `.strict()`, xem `settings-registry.ts`),
 * PATCH một phần sẽ bị reject và rơi về default.
 */
const GROUP_POLICIES_OVERRIDE = {
  member: { mode: "equal", amount: 0, capAtEqual: false },
  memberFemale: { mode: "equal", amount: 0, capAtEqual: false },
  guestMember: { mode: "fixed", amount: 15_000, capAtEqual: false },
  guestMemberFemale: { mode: "equal", amount: 0, capAtEqual: false },
  guestAdmin: { mode: "floor", amount: 60_000, capAtEqual: false },
  guestAdminFemale: { mode: "floor", amount: 60_000, capAtEqual: false },
};

test.beforeAll(async () => {
  const c = await db();

  const adminRow = (
    await c.execute(
      "SELECT member_id FROM admins WHERE member_id IS NOT NULL LIMIT 1",
    )
  ).rows[0];
  adminMemberId = Number(adminRow.member_id);

  const otherRow = (
    await c.execute({
      sql: "SELECT id FROM members WHERE id != ? AND is_active=1 AND approval_status='approved' ORDER BY id LIMIT 1",
      args: [adminMemberId],
    })
  ).rows[0];
  otherMemberId = Number(otherRow.id);

  await c.execute("DELETE FROM sessions WHERE date=?", [TEST_DATE]);
  const inserted = await c.execute({
    sql: `INSERT INTO sessions
      (date, court_id, court_quantity, court_price, dining_bill, status, use_min_deduction, admin_guest_play_count, admin_guest_dine_count)
      VALUES (?, NULL, 1, ?, 0, 'voting', 0, 0, 0)`,
    args: [TEST_DATE, COURT_PRICE],
  });
  sessionId = Number(inserted.lastInsertRowid);

  // Admin tự vote CHƠI + tự thêm 1 khách qua CHÍNH dòng vote của mình (KHÔNG
  // qua ô đếm "Khách của admin" riêng — admin_guest_play_count ở trên = 0).
  await c.execute({
    sql: `INSERT INTO votes (session_id, member_id, will_play, will_dine, guest_play_count, guest_dine_count, with_partner)
      VALUES (?, ?, 1, 0, 1, 0, 0)`,
    args: [sessionId, adminMemberId],
  });
  // Member thường khác — chơi, không khách — chỉ để có ≥2 đầu trong rổ chia đều.
  await c.execute({
    sql: `INSERT INTO votes (session_id, member_id, will_play, will_dine, guest_play_count, guest_dine_count, with_partner)
      VALUES (?, ?, 1, 0, 0, 0, 0)`,
    args: [sessionId, otherMemberId],
  });

  await c.execute({
    sql: "INSERT INTO app_settings (key, value) VALUES ('groupPolicies', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    args: [JSON.stringify(GROUP_POLICIES_OVERRIDE)],
  });
  c.close();
});

test.afterAll(async () => {
  const c = await db();
  await c.execute("DELETE FROM sessions WHERE date=?", [TEST_DATE]);
  await c.execute("DELETE FROM app_settings WHERE key='groupPolicies'");
  c.close();
});

// Ca chặn hồi quy chính của Task 14: khách nằm trong CHÍNH dòng vote của admin
// phải tính theo chính sách khách-của-admin (`guestAdmin`, floor 60K), KHÔNG
// phải khách-của-member (`guestMember`, fixed 15K ở test này). Trước Task 14,
// 3 màn xem trước chỉ trừ ô đếm `guestPlayCount - adminGuestPlayCount` nên bỏ
// sót đúng khách này → preview hiện 68.000/người thay vì 45.000/người thật
// (2 đầu chia đều rổ = 2 member, sàn khách-admin 60K trừ ra trước:
// (150.000 − 60.000) / 2 = 45.000; công thức cũ: (150.000 − 15.000) / 2 =
// 67.500 → làm tròn LÊN 1K = 68.000 — khác hẳn, không thể trùng ngẫu nhiên).
test("khách trong dòng vote của admin tính theo giá khách-của-admin trên preview /admin/sessions/[id]", async ({
  page,
}) => {
  await page.goto(`/admin/sessions/${sessionId}`, {
    waitUntil: "domcontentloaded",
  });

  // `.first()` KHÔNG phải để né lỗi: trang này gọi `usePolling()` →
  // `router.refresh()` mỗi 5 GIÂY (`session-detail.tsx:97`). Mỗi lần refresh,
  // React tráo cây cũ sang cây mới và trong khoảnh khắc đó khối chi phí tồn
  // tại HAI bản trong DOM. Locator chặt assert trúng đúng lúc tráo sẽ chết vì
  // "resolved to 2 elements", nên bài này xanh/đỏ theo chu kỳ 5 giây — đã tái
  // hiện: chạy 2 lượt liền thì lượt sau đỏ, chèn thêm một lệnh đọc DOM cho
  // chậm lại vài chục ms thì cả 2 lượt xanh, và DB trước/sau giống hệt nhau.
  //
  // Cũng KHÔNG dùng `waitForLoadState("networkidle")` được: trang poll liên
  // tục nên mạng không bao giờ idle, chờ nó là treo tới hết timeout.
  await expect(page.getByText("💰 Tổng chi").first()).toBeVisible();
  // Đúng: rổ chia đều (admin + member khác) trả 45.000/người sau khi khách-
  // của-admin trả sàn 60K riêng.
  await expect(page.getByText("🏸 45.000").first()).toBeVisible();
  // Sai (bug cũ): nếu khách bị gộp nhầm vào khách-của-member (fixed 15K), rổ
  // chia đều sẽ ra 68.000/người — số này KHÔNG được xuất hiện.
  await expect(page.getByText("🏸 68.000")).toHaveCount(0);
});

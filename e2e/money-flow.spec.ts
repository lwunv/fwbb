import { test, expect } from "@playwright/test";
import { createClient } from "@libsql/client";
import { expectNoAppError } from "./utils";

/**
 * E2E hết đường ống tiền: bấm "Xác nhận buổi chơi" THẬT trên UI (không gọi
 * thẳng server action như 8 file finalize-*.integration.test.ts), rồi đối
 * chiếu số trong DB với số tính tay. Trước file này KHÔNG có e2e nào thật sự
 * chốt sổ một buổi — 2 spec khác chỉ nhắc chữ "finalize" trong comment, không
 * nút nào bị bấm.
 *
 * Case 1: 3 nhóm chính sách khác hẳn nhau (member chia đều / guestMember
 * fixed 15K / guestAdmin floor 60K) ra 3 con số khác hẳn nhau — phân loại sai
 * là lộ ngay, không thể trùng ngẫu nhiên.
 * Case 2: đổi `minDeductionAmount` RỒI chốt lại buổi ĐÃ chốt qua UI thật (nút
 * "Mở lại" → "Xác nhận buổi chơi" lại) — số phải KHÔNG đổi vì
 * `settings_snapshot` đã đóng băng cấu hình lúc chốt lần đầu.
 *
 * Vì sao KHÔNG dùng ngày xa tương lai như các spec khác (2099-*): nút "Xác
 * nhận buổi chơi" chỉ bật khi `session.date <= hôm nay`
 * (`canFinalize = isActive && session.date <= todayYmd` ở session-list.tsx)
 * — buổi tương lai không bao giờ finalize được qua UI thật, nên dùng ngày
 * tương lai như các spec khác sẽ làm nút không bao giờ xuất hiện. Dùng một
 * ngày QUÁ KHỨ xa, không đụng ngày nào spec khác đã seed (đã grep toàn bộ
 * `e2e/*.spec.ts`).
 *
 * Không gọi `loginAsAdmin` — mọi spec trong repo đều dùng chung
 * `storageState: "e2e/.auth/admin.json"` do `auth.setup.ts` tạo 1 lần, không
 * spec nào tự login lại.
 */

const TEST_DATE = "2020-02-10";
const COURT_PRICE = 100_000;
const X_FACEBOOK_ID = "fb-moneyflow-x-e2e";
const Y_FACEBOOK_ID = "fb-moneyflow-y-e2e";

async function db() {
  const c = createClient({ url: "file:e2e/local.db" });
  // Fixture và server Next mở CÙNG file e2e/local.db, nên ghi đồng thời làm
  // SQLITE_BUSY. Chờ lock nhả thay vì chết ngay. Cùng cách src/db/test-db.ts
  // đã dùng cho test tích hợp.
  await c.execute("PRAGMA busy_timeout = 5000");
  return c;
}

/**
 * Đủ TRỌN 6 nhóm — schema `.strict()` ở settings-registry.ts reject object
 * thiếu field và rơi về default, khiến test không chứng minh được gì (xem
 * e2e/admin-guest-classification.spec.ts, nơi lấy mẫu shape này). 3 nhóm
 * đang dùng thật (member/guestMember/guestAdmin) cố tình khác hẳn nhau để
 * bất kỳ nhầm lẫn phân loại nào cũng ra một con số thấy ngay.
 */
const GROUP_POLICIES = {
  member: { mode: "equal", amount: 0, capAtEqual: false },
  memberFemale: { mode: "equal", amount: 0, capAtEqual: false },
  guestMember: { mode: "fixed", amount: 15_000, capAtEqual: false },
  guestMemberFemale: { mode: "equal", amount: 0, capAtEqual: false },
  guestAdmin: { mode: "floor", amount: 60_000, capAtEqual: false },
  guestAdminFemale: { mode: "floor", amount: 60_000, capAtEqual: false },
};

let sessionId: number;
let adminMemberId: number;
let xMemberId: number;
let yMemberId: number;
let priorGroupPolicies: string | null = null;
let priorMinDeduction: string | null = null;

test.beforeAll(async () => {
  const c = await db();

  const adminRow = (
    await c.execute(
      "SELECT member_id FROM admins WHERE member_id IS NOT NULL LIMIT 1",
    )
  ).rows[0];
  adminMemberId = Number(adminRow.member_id);

  // Idempotency: nếu lần chạy trước bị ngắt giữa chừng (afterAll chưa kịp
  // chạy), facebook_id unique sẽ làm insert bên dưới lỗi nếu không dọn trước.
  await c.execute({
    sql: "DELETE FROM members WHERE facebook_id IN (?, ?)",
    args: [X_FACEBOOK_ID, Y_FACEBOOK_ID],
  });

  // 2 member RIÊNG cho test này (không đụng member thật) — X đủ quỹ, Y
  // balance=0, để tách bạch rõ "chính sách nhóm" (group-policy, case 1) khỏi
  // "sàn member-nghèo" (min-deduction floor, cơ chế KHÁC — xem hand-calc
  // trong test case 1).
  const insertedX = await c.execute({
    sql: "INSERT INTO members (name, facebook_id) VALUES (?, ?)",
    args: ["E2E MoneyFlow X", X_FACEBOOK_ID],
  });
  xMemberId = Number(insertedX.lastInsertRowid);
  const insertedY = await c.execute({
    sql: "INSERT INTO members (name, facebook_id) VALUES (?, ?)",
    args: ["E2E MoneyFlow Y", Y_FACEBOOK_ID],
  });
  yMemberId = Number(insertedY.lastInsertRowid);

  // Lưu giá trị GỐC của 2 setting sắp bị ghi đè — afterAll phục hồi ĐÚNG giá
  // trị này (không xóa trắng), vì spec khác đọc chúng.
  const gpRow = (
    await c.execute("SELECT value FROM app_settings WHERE key='groupPolicies'")
  ).rows[0];
  priorGroupPolicies = gpRow ? String(gpRow.value) : null;
  const mdRow = (
    await c.execute(
      "SELECT value FROM app_settings WHERE key='minDeductionAmount'",
    )
  ).rows[0];
  priorMinDeduction = mdRow ? String(mdRow.value) : null;

  await c.execute({
    sql: "INSERT INTO app_settings (key, value) VALUES ('groupPolicies', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    args: [JSON.stringify(GROUP_POLICIES)],
  });

  // Raw DELETE FROM sessions ở đây (và ở afterAll bên dưới) là ngoại lệ có
  // chủ đích, KHÔNG áp dụng rule "phải qua deleteSession" của AGENTS.md: rule
  // đó bảo vệ session THẬT có ledger cần reverse trước khi xóa. Đây là DB
  // throwaway (file:e2e/local.db) và dòng này chỉ dọn tàn dư của LẦN CHẠY
  // TRƯỚC (nếu afterAll từng bị ngắt giữa chừng) — tại thời điểm này chưa có
  // session nào của test tồn tại để chốt sổ, nên không có fund_deduction nào
  // cần reverse. Cùng lý luận với e2e/admin-vote-lock-toggle.spec.ts.
  await c.execute({
    sql: "DELETE FROM sessions WHERE date=?",
    args: [TEST_DATE],
  });
  const insertedSession = await c.execute({
    sql: `INSERT INTO sessions
      (date, court_id, court_quantity, court_price, dining_bill, status, use_min_deduction, admin_guest_play_count, admin_guest_dine_count)
      VALUES (?, NULL, 1, ?, 0, 'voting', 1, 1, 0)`,
    args: [TEST_DATE, COURT_PRICE],
  });
  sessionId = Number(insertedSession.lastInsertRowid);

  // Admin tự chơi, không khách qua vote — khách CỦA admin đi qua
  // admin_guest_play_count ở trên: finalizeSessionAuto tự build 1 attendee
  // "Khách Admin 1" với invitedById = adminMemberId → nhóm guestAdmin.
  await c.execute({
    sql: `INSERT INTO votes (session_id, member_id, will_play, will_dine, guest_play_count, guest_dine_count, with_partner)
      VALUES (?, ?, 1, 0, 0, 0, 0)`,
    args: [sessionId, adminMemberId],
  });
  // X chơi + mời 1 khách (nhóm guestMember, fixed 15K).
  await c.execute({
    sql: `INSERT INTO votes (session_id, member_id, will_play, will_dine, guest_play_count, guest_dine_count, with_partner)
      VALUES (?, ?, 1, 0, 1, 0, 0)`,
    args: [sessionId, xMemberId],
  });
  // Y chơi, không khách — balance=0 nên sẽ dính sàn min-deduction.
  await c.execute({
    sql: `INSERT INTO votes (session_id, member_id, will_play, will_dine, guest_play_count, guest_dine_count, with_partner)
      VALUES (?, ?, 1, 0, 0, 0, 0)`,
    args: [sessionId, yMemberId],
  });

  // X nạp quỹ đủ (50.000 ≥ playAmount 9.000/người tính tay bên dưới) để
  // KHÔNG dính sàn member-nghèo — chỉ Y (balance=0) mới bị floor, tách bạch
  // rõ 2 cơ chế trong cùng 1 buổi.
  await c.execute({
    sql: "INSERT INTO financial_transactions (type, direction, amount, member_id) VALUES ('fund_contribution', 'in', ?, ?)",
    args: [50_000, xMemberId],
  });

  c.close();
});

test.afterAll(async () => {
  const c = await db();

  // Dọn theo thứ tự tôn trọng FK: ledger → debts → attendees/shuttlecocks/
  // votes → session → member tạm → phục hồi app_settings.
  await c.execute({
    sql: "DELETE FROM financial_transactions WHERE session_id=?",
    args: [sessionId],
  });
  await c.execute({
    sql: "DELETE FROM financial_transactions WHERE member_id IN (?, ?)",
    args: [xMemberId, yMemberId],
  });
  await c.execute({
    sql: "DELETE FROM session_min_deduction_exemptions WHERE session_id=?",
    args: [sessionId],
  });
  await c.execute({
    sql: "DELETE FROM session_debts WHERE session_id=?",
    args: [sessionId],
  });
  await c.execute({
    sql: "DELETE FROM session_attendees WHERE session_id=?",
    args: [sessionId],
  });
  await c.execute({
    sql: "DELETE FROM session_shuttlecocks WHERE session_id=?",
    args: [sessionId],
  });
  await c.execute({
    sql: "DELETE FROM votes WHERE session_id=?",
    args: [sessionId],
  });
  // Raw DELETE (ngoại lệ có chủ đích, xem comment ở beforeAll): tới đây mọi
  // financial_transactions + session_debts của buổi này ĐÃ bị xóa ở các lệnh
  // đầu hàm này rồi (không còn fund_deduction nào sống để cần reverse), nên
  // xóa thẳng session là an toàn trên DB throwaway này.
  await c.execute({
    sql: "DELETE FROM sessions WHERE date=?",
    args: [TEST_DATE],
  });
  await c.execute({
    sql: "DELETE FROM members WHERE id IN (?, ?)",
    args: [xMemberId, yMemberId],
  });

  // Phục hồi ĐÚNG giá trị gốc thay vì xóa trắng — spec khác đọc 2 setting này.
  if (priorGroupPolicies === null) {
    await c.execute("DELETE FROM app_settings WHERE key='groupPolicies'");
  } else {
    await c.execute({
      sql: "UPDATE app_settings SET value=? WHERE key='groupPolicies'",
      args: [priorGroupPolicies],
    });
  }
  if (priorMinDeduction === null) {
    await c.execute("DELETE FROM app_settings WHERE key='minDeductionAmount'");
  } else {
    await c.execute({
      sql: "UPDATE app_settings SET value=? WHERE key='minDeductionAmount'",
      args: [priorMinDeduction],
    });
  }

  // Verify dọn sạch THẬT — không còn dấu vết ngày/member tạm ở bất kỳ bảng
  // nào, để lần chạy sau (hoặc spec khác) không kế thừa balance/ledger ma.
  const leftoverSessions = Number(
    (
      await c.execute({
        sql: "SELECT COUNT(*) as n FROM sessions WHERE date=?",
        args: [TEST_DATE],
      })
    ).rows[0].n,
  );
  const leftoverMembers = Number(
    (
      await c.execute({
        sql: "SELECT COUNT(*) as n FROM members WHERE id IN (?, ?)",
        args: [xMemberId, yMemberId],
      })
    ).rows[0].n,
  );
  const leftoverDebts = Number(
    (
      await c.execute({
        sql: "SELECT COUNT(*) as n FROM session_debts WHERE session_id=?",
        args: [sessionId],
      })
    ).rows[0].n,
  );
  const leftoverTx = Number(
    (
      await c.execute({
        sql: "SELECT COUNT(*) as n FROM financial_transactions WHERE session_id=? OR member_id IN (?, ?)",
        args: [sessionId, xMemberId, yMemberId],
      })
    ).rows[0].n,
  );
  const leftoverVotes = Number(
    (
      await c.execute({
        sql: "SELECT COUNT(*) as n FROM votes WHERE session_id=?",
        args: [sessionId],
      })
    ).rows[0].n,
  );

  c.close();

  expect(leftoverSessions, "buổi test phải bị xóa sạch").toBe(0);
  expect(leftoverMembers, "2 member tạm phải bị xóa sạch").toBe(0);
  expect(leftoverDebts, "session_debts phải bị xóa sạch").toBe(0);
  expect(leftoverTx, "financial_transactions phải bị xóa sạch").toBe(0);
  expect(leftoverVotes, "votes phải bị xóa sạch").toBe(0);
});

/**
 * I1 (mở rộng, giống finalize-group-policy.integration.test.ts /
 * finalize-snapshot.integration.test.ts): khách-của-admin KHÔNG nằm trong
 * fund_deduction — nó là thu nhóm `session_guest_income` riêng
 * (memberId=null, xem finance.ts), nên phải cộng cả hai mới khớp
 * Σ debt.totalAmount. "Σ fund_deduction = Σ debt" đơn thuần CHỈ đúng khi buổi
 * không có khách-của-admin — buổi này CÓ (đề bài yêu cầu ít nhất 1 khách của
 * admin), nên dùng đúng công thức mở rộng thay vì bản rút gọn.
 *
 * I8: mọi session_debts đã memberConfirmed+adminConfirmed đều có ít nhất 1
 * dòng ledger (fund_deduction hoặc session_guest_income) cân bằng nó.
 */
async function assertLedgerInvariants(
  c: Awaited<ReturnType<typeof db>>,
  sid: number,
) {
  const debts = (
    await c.execute({
      sql: "SELECT id, total_amount, member_confirmed, admin_confirmed FROM session_debts WHERE session_id=?",
      args: [sid],
    })
  ).rows;
  const txs = (
    await c.execute({
      sql: "SELECT id, type, direction, amount, debt_id, reversal_of_id FROM financial_transactions WHERE session_id=?",
      args: [sid],
    })
  ).rows;

  const isReversed = (id: number) =>
    txs.some((t) => Number(t.reversal_of_id) === id);

  const sumDebt = debts.reduce((s, d) => s + Number(d.total_amount), 0);
  const sumDeduction = txs
    .filter((t) => t.type === "fund_deduction" && !isReversed(Number(t.id)))
    .reduce((s, t) => s + Number(t.amount), 0);
  const sumGuestIncome = txs
    .filter(
      (t) =>
        t.type === "session_guest_income" &&
        t.direction === "in" &&
        !isReversed(Number(t.id)),
    )
    .reduce((s, t) => s + Number(t.amount), 0);
  expect(sumDeduction + sumGuestIncome).toBe(sumDebt);

  for (const d of debts) {
    expect(Number(d.member_confirmed)).toBe(1);
    expect(Number(d.admin_confirmed)).toBe(1);
    if (Number(d.total_amount) > 0) {
      const ownTxs = txs.filter((t) => Number(t.debt_id) === Number(d.id));
      const hasBalancingRow = ownTxs.some(
        (t) => t.type === "fund_deduction" || t.type === "session_guest_income",
      );
      expect(hasBalancingRow).toBe(true);
    }
  }
}

/** Optimistic UI đổi giao diện ngay nhưng ghi DB là async — poll thay vì đoán
 *  thời gian cố định (cùng cách e2e/admin-username.spec.ts đã dùng). */
async function waitForDebtCount(expected: number) {
  await expect
    .poll(
      async () => {
        const c = await db();
        const r = await c.execute({
          sql: "SELECT COUNT(*) as n FROM session_debts WHERE session_id=?",
          args: [sessionId],
        });
        c.close();
        return Number(r.rows[0].n);
      },
      { timeout: 15_000 },
    )
    .toBe(expected);
}

async function readDebtsByMember() {
  const c = await db();
  const rows = (
    await c.execute({
      sql: "SELECT member_id, total_amount FROM session_debts WHERE session_id=?",
      args: [sessionId],
    })
  ).rows;
  c.close();
  return new Map(
    rows.map((r) => [Number(r.member_id), Number(r.total_amount)]),
  );
}

// .serial: case 2 chốt lại CHÍNH buổi case 1 vừa tạo — phụ thuộc thứ tự thật
// (không phải "cho gọn"), nên case 1 fail thì case 2 phải bị bỏ qua thay vì
// chạy trên state dở dang.
test.describe
  .serial("chốt sổ qua UI thật — group-policy + snapshot đóng băng (Task 12)", () => {
  test("case 1 — 3 nhóm chính sách khác hẳn nhau ra đúng số tính tay", async ({
    page,
  }) => {
    await page.goto(`/admin/sessions?from=${TEST_DATE}&to=${TEST_DATE}`, {
      waitUntil: "domcontentloaded",
    });
    await expectNoAppError(page);

    await page.getByRole("button", { name: "Xác nhận buổi chơi" }).click();
    await waitForDebtCount(3);

    const byMember = await readDebtsByMember();

    /*
     * Tính tay — xem GROUP_POLICIES ở đầu file:
     * totalPlayCost = courtPrice 100.000 (không cầu lông, không nhậu).
     * Rổ chia đều ban đầu chỉ gồm 3 member (admin, X, Y) = 3 đầu
     * (guestMember fixed và guestAdmin floor đứng ngoài rổ lúc đầu).
     * fixedTotal = guestMember 15.000×1 + guestAdmin 60.000×1 = 75.000.
     * equalRate = (100.000 − 75.000) / 3 = 8.333,33.
     * Kiểm tra dời rổ: guestAdmin floor 60.000 ≤ 8.333,33? KHÔNG → không
     * dời, khách admin trả nguyên sàn 60.000. guestMember fixed
     * capAtEqual=false → không bao giờ dời. Vòng lặp dừng ngay.
     * → pooled = roundToThousand(8.333,33) = 9.000 (làm tròn LÊN 1K).
     *
     * Admin: playAmount 9.000 (nhóm "member") + guestPlayAmount (khách của
     *   CHÍNH admin, nhóm guestAdmin) 60.000 = 69.000.
     * X: playAmount 9.000 + guestPlayAmount (khách của X, nhóm
     *   guestMember, fixed) 15.000 = 24.000. X nạp quỹ 50.000 ≥ 9.000 nên
     *   KHÔNG bị sàn member-nghèo.
     * Y: playAmount gốc 9.000 — nhưng balance=0 và 9.000 < sàn
     *   member-nghèo mặc định 60.000 (chưa đổi setting nào ở case này) →
     *   floor nâng lên 60.000 (applyMinDeductionFloor — cơ chế KHÁC với
     *   guestAdmin floor ở trên, 2 sàn độc lập, xem cost-calculator.ts).
     *
     * Nếu khách của admin bị phân loại nhầm thành guestMember (fixed
     * 15.000) hay ngược lại, số của Admin/X sẽ lệch hẳn — đây là ca chặn
     * hồi quy chính của test này.
     */
    expect(byMember.get(adminMemberId)).toBe(69_000);
    expect(byMember.get(xMemberId)).toBe(24_000);
    expect(byMember.get(yMemberId)).toBe(60_000);

    const c = await db();
    await assertLedgerInvariants(c, sessionId);
    c.close();
  });

  test("case 2 — đổi minDeductionAmount rồi chốt lại qua UI (Mở lại → Xác nhận buổi chơi): số KHÔNG đổi", async ({
    page,
  }) => {
    // Mô phỏng admin vào trang Settings đổi sàn member-nghèo SAU KHI buổi
    // này đã chốt sổ xong ở case 1 — settings_snapshot phải thắng giá trị
    // mới này (Task 10, phase 3).
    const c0 = await db();
    await c0.execute({
      sql: "INSERT INTO app_settings (key, value) VALUES ('minDeductionAmount', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      args: [JSON.stringify(100_000)],
    });
    c0.close();

    await page.goto(`/admin/sessions?from=${TEST_DATE}&to=${TEST_DATE}`, {
      waitUntil: "domcontentloaded",
    });
    await expectNoAppError(page);

    // Buổi đã completed ở case 1 → chỉ còn đường "Mở lại" để chốt lại qua
    // UI thật (finalizeSessionAuto tự chặn re-finalize khi status đã
    // completed, xem finance.ts:603-608).
    await page.getByRole("button", { name: "Mở lại" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Mở lại" })
      .click();

    // Chờ unlockSession (reverse fund_deduction, xóa attendees+debts, status
    // về voting) commit XONG trước khi bấm chốt lại — tránh finalizeSessionAuto
    // chạy đè lên transaction unlock chưa kịp xong.
    await expect
      .poll(
        async () => {
          const c = await db();
          const r = await c.execute({
            sql: "SELECT status FROM sessions WHERE id=?",
            args: [sessionId],
          });
          c.close();
          return r.rows[0]?.status ?? null;
        },
        { timeout: 15_000 },
      )
      .toBe("voting");

    // Cùng nút, cùng action — giờ bật lại vì status đã về voting.
    await page.getByRole("button", { name: "Xác nhận buổi chơi" }).click();
    await waitForDebtCount(3);

    const byMember = await readDebtsByMember();

    // Đúng bằng case 1 dù minDeductionAmount hiện tại đã đổi thành
    // 100.000 — settings_snapshot đóng băng lúc chốt lần đầu (còn 60.000,
    // mặc định) thắng. Nếu snapshot KHÔNG thắng, Y sẽ ra 100.000 thay vì
    // 60.000 — khác hẳn, không thể trùng ngẫu nhiên.
    expect(byMember.get(adminMemberId)).toBe(69_000);
    expect(byMember.get(xMemberId)).toBe(24_000);
    expect(byMember.get(yMemberId)).toBe(60_000);

    const c = await db();
    await assertLedgerInvariants(c, sessionId);
    c.close();
  });
});

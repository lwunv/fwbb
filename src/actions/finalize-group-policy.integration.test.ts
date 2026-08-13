/**
 * Integration tests — Task 4 (giai đoạn 3): `finalizeSession` phải đọc chính
 * sách tiền từ `app_settings` (`minDeductionAmount`, `groupPolicies`) thay vì
 * hằng số hardcode. Cho tới bây giờ hai setting này tồn tại trong registry
 * nhưng KHÔNG được `finalizeSession` đọc — đây là task nối chúng vào chốt sổ
 * thật.
 *
 * 4 ca theo brief:
 *  1. Không đổi setting (app_settings rỗng) → số ra giống hệt hằng số cũ
 *     (mốc 23K/37K/60K, giữ nguyên `finalize-min-deduction.integration.test.ts`).
 *  2. Đổi `minDeductionAmount` lên 70K → sàn member-nghèo đổi theo 70K.
 *  3. Đổi `groupPolicies.guestAdmin` thành cố định 80K → khách-của-admin trả
 *     80K, phần dư giảm cho nhóm chia đều (mốc từ
 *     `finalize-admin-guest-income.integration.test.ts`, ở đó sàn mặc định 60K).
 *  4 (gộp vào cả 3 ca trên): Σ fund_deduction + Σ session_guest_income khớp
 *     Σ debt.totalAmount (I1 rút gọn theo buổi — khách-của-admin không nằm
 *     trong fund_deduction mà đi qua session_guest_income riêng), và mọi dòng
 *     nợ đã confirmed đều có ít nhất 1 dòng ledger cân bằng (I8).
 *
 * Spec: docs/superpowers/plans/2026-08-13-admin-settings-phase3.md,
 * .superpowers/sdd/2026-08-13-admin-settings-phase3/task-4-brief.md
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  members,
  sessions,
  sessionDebts,
  financialTransactions,
  admins as adminsTable,
  appSettings,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { DEFAULT_GROUP_POLICIES } from "@/lib/group-policy";

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
  getAdminFromCookie: vi.fn(async () => ({ sub: "1", role: "admin" })),
}));
import { requireAdmin } from "@/lib/auth";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/messenger", () => ({
  sendGroupMessage: vi.fn(),
  buildDebtReminderMessage: vi.fn(() => ""),
  buildNewSessionMessage: vi.fn(),
  buildConfirmedMessage: vi.fn(),
}));
vi.mock("@/lib/user-identity", () => ({
  getUserFromCookie: vi.fn(async () => null),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { finalizeSession } = await import("./finance");

async function reset() {
  await client.execute("DELETE FROM payment_notifications");
  await client.execute("DELETE FROM financial_transactions");
  await client.execute("DELETE FROM session_min_deduction_exemptions");
  await client.execute("DELETE FROM session_debts");
  await client.execute("DELETE FROM session_attendees");
  await client.execute("DELETE FROM session_shuttlecocks");
  await client.execute("DELETE FROM votes");
  await client.execute("DELETE FROM sessions");
  await client.execute("DELETE FROM admins");
  await client.execute("DELETE FROM members");
  await client.execute("DELETE FROM app_settings");
}

/**
 * Seed: 1 admin member + 3 member thường. Cùng pattern với
 * `finalize-min-deduction.integration.test.ts` để case 1 là mốc y hệt.
 */
async function seedActors() {
  const inserted = await testDb
    .insert(members)
    .values([
      { name: "Admin", facebookId: "fb-admin-gp" },
      { name: "Alice", facebookId: "fb-alice-gp" },
      { name: "Bob", facebookId: "fb-bob-gp" },
      { name: "Carol", facebookId: "fb-carol-gp" },
    ])
    .returning({ id: members.id });
  const [adminMember, alice, bob, carol] = inserted;

  const [adminRow] = await testDb
    .insert(adminsTable)
    .values({
      username: "AdminGP",
      passwordHash: "x",
      memberId: adminMember.id,
    })
    .returning({ id: adminsTable.id });

  vi.mocked(requireAdmin).mockResolvedValue({
    admin: { sub: String(adminRow.id), role: "admin" },
  } as never);

  return {
    adminMemberId: adminMember.id,
    aliceId: alice.id,
    bobId: bob.id,
    carolId: carol.id,
  };
}

async function contributeToFund(memberId: number, amount: number) {
  await testDb.insert(financialTransactions).values({
    type: "fund_contribution",
    direction: "in",
    amount,
    memberId,
  });
}

/** Ghi 1 app_settings row đúng format JSON mà `serializeSetting` dùng ở
 *  production — test không gọi `updateSetting` (cần requireAdmin thật + revalidatePath)
 *  vì mock ở đây đã đủ, ghi thẳng bảng cho gọn. */
async function setSetting(key: string, value: unknown) {
  await testDb
    .insert(appSettings)
    .values({ key, value: JSON.stringify(value) });
}

async function seedSessionWithMinDeduction(courtPrice: number) {
  const date = `2026-05-${String(Math.floor(Math.random() * 27) + 1).padStart(2, "0")}`;
  const [s] = await testDb
    .insert(sessions)
    .values({ date, status: "confirmed", courtPrice, useMinDeduction: true })
    .returning({ id: sessions.id });
  return s.id;
}

function playAttendee(memberId: number) {
  return {
    memberId,
    guestName: null,
    invitedById: null,
    isGuest: false,
    attendsPlay: true,
    attendsDine: false,
  };
}

/**
 * Khoá 2 bất biến cho TOÀN BỘ ledger của 1 buổi:
 *  - I1 rút gọn theo buổi: khách-của-admin không nằm trong fund_deduction (nó
 *    đi qua session_guest_income riêng — xem finance.ts), nên phải cộng cả
 *    hai mới ra đúng Σ debt.totalAmount. Không cộng nhầm sẽ lộ ra ngay ở case 3
 *    (có khách-admin).
 *  - I8: mọi dòng nợ đã memberConfirmed+adminConfirmed đều có ít nhất 1 dòng
 *    ledger cân bằng nó (fund_deduction cho phần cá nhân, hoặc
 *    session_guest_income khi là khách-của-admin) — trừ khi totalAmount = 0.
 */
async function assertLedgerInvariants(sessionId: number) {
  const debts = await testDb.query.sessionDebts.findMany({
    where: eq(sessionDebts.sessionId, sessionId),
  });
  const txs = await testDb.query.financialTransactions.findMany({
    where: eq(financialTransactions.sessionId, sessionId),
  });

  const sumDebt = debts.reduce((s, d) => s + d.totalAmount, 0);
  const sumDeduction = txs
    .filter((t) => t.type === "fund_deduction")
    .reduce((s, t) => s + t.amount, 0);
  const sumGuestIncome = txs
    .filter((t) => t.type === "session_guest_income")
    .reduce((s, t) => s + t.amount, 0);
  expect(sumDeduction + sumGuestIncome).toBe(sumDebt);

  for (const d of debts) {
    expect(d.memberConfirmed).toBe(true);
    expect(d.adminConfirmed).toBe(true);
    if (d.totalAmount > 0) {
      const ownTxs = txs.filter((t) => t.debtId === d.id);
      const hasBalancingRow = ownTxs.some(
        (t) => t.type === "fund_deduction" || t.type === "session_guest_income",
      );
      expect(hasBalancingRow).toBe(true);
    }
  }
}

describe("finalizeSession — đọc chính sách tiền từ settings (Task 4)", () => {
  beforeEach(reset);

  it("case 1 — app_settings rỗng: số ra giống hệt hằng số cũ (mốc 23K/37K/60K)", async () => {
    const { adminMemberId, aliceId, bobId, carolId } = await seedActors();
    // Alice: balance 0. Bob/Carol: đủ quỹ.
    await contributeToFund(bobId, 200_000);
    await contributeToFund(carolId, 200_000);
    const sessionId = await seedSessionWithMinDeduction(90_000);

    const result = await finalizeSession(
      sessionId,
      [adminMemberId, aliceId, bobId, carolId].map(playAttendee),
      0,
    );
    expect("error" in result).toBe(false);

    const debts = await testDb.query.sessionDebts.findMany({
      where: eq(sessionDebts.sessionId, sessionId),
    });
    const byMember = new Map(debts.map((d) => [d.memberId, d]));

    // per-head = roundToThousand(90_000 / 4) = 23_000. Alice thiếu quỹ → sàn 60K.
    expect(byMember.get(adminMemberId)?.totalAmount).toBe(23_000);
    expect(byMember.get(bobId)?.totalAmount).toBe(23_000);
    expect(byMember.get(carolId)?.totalAmount).toBe(23_000);
    expect(byMember.get(aliceId)?.totalAmount).toBe(60_000);

    const penaltyContribs = await testDb.query.financialTransactions.findMany({
      where: and(
        eq(financialTransactions.sessionId, sessionId),
        eq(financialTransactions.type, "fund_contribution"),
        eq(financialTransactions.memberId, adminMemberId),
      ),
    });
    expect(penaltyContribs).toHaveLength(1);
    expect(penaltyContribs[0].amount).toBe(37_000); // 60K − 23K

    await assertLedgerInvariants(sessionId);
  });

  it("case 2 — minDeductionAmount = 70K: member thiếu quỹ bị sàn 70K thay vì 60K", async () => {
    await setSetting("minDeductionAmount", 70_000);
    const { adminMemberId, aliceId, bobId, carolId } = await seedActors();
    await contributeToFund(bobId, 200_000);
    await contributeToFund(carolId, 200_000);
    const sessionId = await seedSessionWithMinDeduction(90_000);

    const result = await finalizeSession(
      sessionId,
      [adminMemberId, aliceId, bobId, carolId].map(playAttendee),
      0,
    );
    expect("error" in result).toBe(false);

    const debts = await testDb.query.sessionDebts.findMany({
      where: eq(sessionDebts.sessionId, sessionId),
    });
    const byMember = new Map(debts.map((d) => [d.memberId, d]));

    // Alice: playAmount gốc 23K < sàn MỚI 70K → nâng lên 70K (KHÔNG phải 60K —
    // nếu vẫn ra 60K nghĩa là finalizeSession chưa đọc setting, còn ăn hằng số).
    expect(byMember.get(aliceId)?.totalAmount).toBe(70_000);
    // Bob/Carol còn quỹ → không đổi, không bị đụng vào sàn nào.
    expect(byMember.get(bobId)?.totalAmount).toBe(23_000);
    expect(byMember.get(carolId)?.totalAmount).toBe(23_000);

    const penaltyContribs = await testDb.query.financialTransactions.findMany({
      where: and(
        eq(financialTransactions.sessionId, sessionId),
        eq(financialTransactions.type, "fund_contribution"),
        eq(financialTransactions.memberId, adminMemberId),
      ),
    });
    expect(penaltyContribs).toHaveLength(1);
    expect(penaltyContribs[0].amount).toBe(47_000); // 70K − 23K

    await assertLedgerInvariants(sessionId);
  });

  it("case 3 — groupPolicies.guestAdmin cố định 80K: khách-admin trả 80K, phần dư giảm cho nhóm chia đều", async () => {
    await setSetting("groupPolicies", {
      ...DEFAULT_GROUP_POLICIES,
      guestAdmin: { mode: "fixed", amount: 80_000, capAtEqual: false },
    });
    const { adminMemberId, aliceId, bobId } = await seedActors();

    const [s] = await testDb
      .insert(sessions)
      .values({
        date: "2026-06-15",
        status: "confirmed",
        courtPrice: 200_000,
        adminGuestPlayCount: 1,
        adminGuestDineCount: 0,
        // Tắt sàn member-nghèo để cô lập đúng hành vi guestAdmin — sàn kia có
        // test riêng ở case 1/2 và ở Step 3b (cost-calculator.test.ts).
        useMinDeduction: false,
      })
      .returning({ id: sessions.id });

    const result = await finalizeSession(
      s.id,
      [
        playAttendee(adminMemberId),
        playAttendee(aliceId),
        playAttendee(bobId),
        {
          memberId: null,
          guestName: "Khach Admin 1",
          invitedById: adminMemberId,
          isGuest: true,
          attendsPlay: true,
          attendsDine: false,
        },
      ],
      0,
    );
    expect("error" in result).toBe(false);

    const debts = await testDb.query.sessionDebts.findMany({
      where: eq(sessionDebts.sessionId, s.id),
    });
    const byMember = new Map(debts.map((d) => [d.memberId, d]));

    // (200K − 80K) / 3 người chia đều = 40K/người — KHÔNG phải 60K (sàn cũ) —
    // nếu vẫn ra 47K (mốc cũ với sàn 60K mặc định) nghĩa là finalizeSession
    // chưa đọc groupPolicies từ settings.
    expect(byMember.get(aliceId)?.playAmount).toBe(40_000);
    expect(byMember.get(bobId)?.playAmount).toBe(40_000);
    expect(byMember.get(adminMemberId)?.playAmount).toBe(40_000);
    expect(byMember.get(adminMemberId)?.guestPlayAmount).toBe(80_000);

    const income = await testDb.query.financialTransactions.findMany({
      where: and(
        eq(financialTransactions.sessionId, s.id),
        eq(financialTransactions.type, "session_guest_income"),
      ),
    });
    expect(income).toHaveLength(1);
    expect(income[0].amount).toBe(80_000);

    // Admin không bị trừ quỹ phần khách (đi qua session_guest_income riêng).
    const adminDeduction = await testDb.query.financialTransactions.findFirst({
      where: and(
        eq(financialTransactions.sessionId, s.id),
        eq(financialTransactions.memberId, adminMemberId),
        eq(financialTransactions.type, "fund_deduction"),
      ),
    });
    expect(adminDeduction?.amount).toBe(40_000);

    await assertLedgerInvariants(s.id);
  });
});

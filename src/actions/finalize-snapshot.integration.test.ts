/**
 * Integration tests — Task 10 (giai đoạn 3): đóng băng cấu hình tiền lúc
 * `finalizeSession` chốt sổ, ghi vào `sessions.settings_snapshot`. Chốt lại
 * một buổi đã xong PHẢI dùng lại đúng cấu hình lần đầu, không đọc setting
 * hiện tại — nếu không, admin đổi sàn rồi bấm chốt lại buổi tháng trước sẽ
 * tính lại tiền đã settled theo cấu hình mới, im lặng.
 *
 * 4 ca theo brief (`.superpowers/sdd/2026-08-13-admin-settings-phase3/task-10-brief.md`):
 *  1. Chốt sổ lần đầu → `settings_snapshot` khác null, parse ra đúng cấu hình
 *     vừa dùng (toàn bộ AppSettings, không chỉ 3 key tiền).
 *  2. Đổi setting rồi chốt lại buổi đó → số tiền từng member KHÔNG đổi (ca
 *     quan trọng nhất — toàn bộ lý do task này tồn tại).
 *  3. Buổi chốt lần đầu SAU KHI admin đã đổi setting → dùng cấu hình mới
 *     (chưa có snapshot nên không đóng băng gì).
 *  4 (gộp vào mọi ca trên qua `assertLedgerInvariants`): Σ fund_deduction +
 *     Σ session_guest_income khớp Σ debt.totalAmount (I1), và mọi dòng nợ
 *     confirmed đều có ít nhất 1 dòng ledger cân bằng (I8).
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
import { eq } from "drizzle-orm";
import { defaultSettings } from "@/lib/settings-registry";

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

async function seedActors(suffix: string) {
  const inserted = await testDb
    .insert(members)
    .values([
      { name: "Admin", facebookId: `fb-admin-snap-${suffix}` },
      { name: "Alice", facebookId: `fb-alice-snap-${suffix}` },
      { name: "Bob", facebookId: `fb-bob-snap-${suffix}` },
      { name: "Carol", facebookId: `fb-carol-snap-${suffix}` },
    ])
    .returning({ id: members.id });
  const [adminMember, alice, bob, carol] = inserted;

  const [adminRow] = await testDb
    .insert(adminsTable)
    .values({
      username: `AdminSnap${suffix}`,
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

/** Ghi thẳng 1 row `app_settings` đúng format JSON — tương tự
 *  `finalize-group-policy.integration.test.ts`, test không cần đi qua
 *  `updateSetting` (cần requireAdmin thật). */
async function setSetting(key: string, value: unknown) {
  await testDb
    .insert(appSettings)
    .values({ key, value: JSON.stringify(value) });
}

async function seedSessionWithMinDeduction(courtPrice: number, date: string) {
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

async function getSnapshotSettings(sessionId: number) {
  const row = await testDb.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
    columns: { settingsSnapshot: true },
  });
  if (!row?.settingsSnapshot) return null;
  return JSON.parse(row.settingsSnapshot) as Record<string, unknown>;
}

/**
 * I1 (rút gọn theo buổi) + I8 cho toàn bộ ledger của 1 buổi.
 *
 * Test này chốt lại (re-finalize) CÙNG một buổi nhiều lần trong cùng ca —
 * ledger append-only nên các dòng fund_deduction/session_guest_income của
 * LẦN CHỐT TRƯỚC vẫn còn nằm trong bảng, chỉ bị hoá giải bằng một dòng đối
 * ứng có `reversalOfId` trỏ về nó (xem finance.ts bước 2/2c). Cộng thẳng mọi
 * dòng amount như một buổi chỉ-chốt-một-lần sẽ đếm trùng lịch sử cũ. Phải
 * lọc "live" — dòng CHƯA bị dòng khác reverse — trước khi cộng.
 */
async function assertLedgerInvariants(sessionId: number) {
  const debts = await testDb.query.sessionDebts.findMany({
    where: eq(sessionDebts.sessionId, sessionId),
  });
  const txs = await testDb.query.financialTransactions.findMany({
    where: eq(financialTransactions.sessionId, sessionId),
  });
  const isReversed = (id: number) => txs.some((o) => o.reversalOfId === id);

  const sumDebt = debts.reduce((s, d) => s + d.totalAmount, 0);
  const sumDeduction = txs
    .filter((t) => t.type === "fund_deduction" && !isReversed(t.id))
    .reduce((s, t) => s + t.amount, 0);
  const sumGuestIncome = txs
    .filter(
      (t) =>
        t.type === "session_guest_income" &&
        t.direction === "in" &&
        !isReversed(t.id),
    )
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

describe("finalizeSession — đóng băng cấu hình tiền vào settings_snapshot (Task 10)", () => {
  beforeEach(reset);

  it("ca 1 — chốt sổ lần đầu: settings_snapshot khác null, parse ra đúng các key perSession vừa dùng, KHÔNG kèm thông tin ngân hàng/key khác", async () => {
    const { adminMemberId, aliceId, bobId, carolId } = await seedActors("c1");
    await contributeToFund(bobId, 200_000);
    await contributeToFund(carolId, 200_000);
    const sessionId = await seedSessionWithMinDeduction(90_000, "2026-07-01");

    const result = await finalizeSession(
      sessionId,
      [adminMemberId, aliceId, bobId, carolId].map(playAttendee),
      0,
    );
    expect("error" in result).toBe(false);

    const snap = await getSnapshotSettings(sessionId);
    expect(snap).not.toBeNull();
    // Chỉ 3 key perSession:true được lưu (Fix-2: đóng băng chỉ những gì
    // "có thể khác nhau theo buổi" — KHÔNG lưu toàn bộ AppSettings như bản
    // đầu, vì làm vậy sẽ sao chép bankAccountNo/bankAccountName của club vào
    // mọi buổi đã chốt, mãi mãi).
    expect(snap!.minDeductionAmount).toBe(60_000); // default, chưa đổi setting nào
    expect(snap!.groupPolicies).toEqual(defaultSettings().groupPolicies);
    expect(snap).not.toHaveProperty("appName");
    expect(snap).not.toHaveProperty("bankAccountNo");
    expect(snap).not.toHaveProperty("bankAccountName");

    await assertLedgerInvariants(sessionId);
  });

  it("ca 2 (quan trọng nhất) — đổi minDeductionAmount rồi chốt lại: totalAmount từng member KHÔNG đổi", async () => {
    const { adminMemberId, aliceId, bobId, carolId } = await seedActors("c2");
    // Alice: balance 0 → sẽ bị sàn min-deduction. Bob/Carol đủ quỹ.
    await contributeToFund(bobId, 200_000);
    await contributeToFund(carolId, 200_000);
    const sessionId = await seedSessionWithMinDeduction(90_000, "2026-07-02");
    const attendeeList = [adminMemberId, aliceId, bobId, carolId].map(
      playAttendee,
    );

    // Chốt lần đầu ở sàn mặc định 60K.
    const r1 = await finalizeSession(sessionId, attendeeList, 0);
    expect("error" in r1).toBe(false);

    const debtsAfterFirst = await testDb.query.sessionDebts.findMany({
      where: eq(sessionDebts.sessionId, sessionId),
    });
    const firstAmounts = new Map(
      debtsAfterFirst.map((d) => [d.memberId, d.totalAmount]),
    );
    // per-head = roundToThousand(90_000/4) = 23_000. Alice floor lên 60_000.
    expect(firstAmounts.get(aliceId)).toBe(60_000);
    expect(firstAmounts.get(bobId)).toBe(23_000);
    expect(firstAmounts.get(carolId)).toBe(23_000);
    expect(firstAmounts.get(adminMemberId)).toBe(23_000);

    const snapAfterFirst = await getSnapshotSettings(sessionId);
    expect(snapAfterFirst!.minDeductionAmount).toBe(60_000);

    // Admin đổi setting lên 90K — nếu finalizeSession đọc setting hiện tại
    // (bug cũ) thì Alice sẽ bị floor lên 90K ở lần chốt lại.
    await setSetting("minDeductionAmount", 90_000);

    // Chốt lại CÙNG buổi, CÙNG payload.
    const r2 = await finalizeSession(sessionId, attendeeList, 0);
    expect("error" in r2).toBe(false);

    const debtsAfterSecond = await testDb.query.sessionDebts.findMany({
      where: eq(sessionDebts.sessionId, sessionId),
    });
    const secondAmounts = new Map(
      debtsAfterSecond.map((d) => [d.memberId, d.totalAmount]),
    );

    // Khẳng định CHÍNH: số tiền từng member y hệt lần đầu, KHÔNG bị tính lại
    // theo sàn mới 90K.
    expect(secondAmounts.get(aliceId)).toBe(firstAmounts.get(aliceId));
    expect(secondAmounts.get(bobId)).toBe(firstAmounts.get(bobId));
    expect(secondAmounts.get(carolId)).toBe(firstAmounts.get(carolId));
    expect(secondAmounts.get(adminMemberId)).toBe(
      firstAmounts.get(adminMemberId),
    );
    expect(secondAmounts.get(aliceId)).toBe(60_000); // không phải 90_000

    // Snapshot vẫn giữ 60K — không bị ghi đè bằng cấu hình mới lúc chốt lại.
    const snapAfterSecond = await getSnapshotSettings(sessionId);
    expect(snapAfterSecond!.minDeductionAmount).toBe(60_000);

    await assertLedgerInvariants(sessionId);
  });

  it("ca 3 — chốt lần đầu SAU KHI đổi setting: dùng cấu hình mới (chưa có snapshot để đóng băng)", async () => {
    await setSetting("minDeductionAmount", 90_000);
    const { adminMemberId, aliceId, bobId, carolId } = await seedActors("c3");
    await contributeToFund(bobId, 200_000);
    await contributeToFund(carolId, 200_000);
    const sessionId = await seedSessionWithMinDeduction(90_000, "2026-07-03");

    const result = await finalizeSession(
      sessionId,
      [adminMemberId, aliceId, bobId, carolId].map(playAttendee),
      0,
    );
    expect("error" in result).toBe(false);

    const debts = await testDb.query.sessionDebts.findMany({
      where: eq(sessionDebts.sessionId, sessionId),
    });
    const byMember = new Map(debts.map((d) => [d.memberId, d.totalAmount]));

    // Buổi này chưa từng chốt trước đó → không có gì để đóng băng → dùng
    // đúng sàn MỚI 90K cho Alice (không phải 60K mặc định).
    expect(byMember.get(aliceId)).toBe(90_000);
    expect(byMember.get(bobId)).toBe(23_000);
    expect(byMember.get(carolId)).toBe(23_000);

    const snap = await getSnapshotSettings(sessionId);
    expect(snap!.minDeductionAmount).toBe(90_000);

    await assertLedgerInvariants(sessionId);
  });
});

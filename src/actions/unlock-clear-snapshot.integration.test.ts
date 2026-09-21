/**
 * Task 11: van xả cho cấu hình tiền đã đóng băng.
 *
 * Task 10 đóng băng cấu hình để chốt lại một buổi cũ không âm thầm tính lại
 * tiền đã settled. Task 11 cho admin chủ động bỏ đóng băng, nhưng phải là một
 * lựa chọn CÓ Ý THỨC: mặc định `unlockSession` không đụng gì tới snapshot.
 *
 * Ca 1 là ca chống hồi quy cho hành vi production hiện tại. Ca 3 là cặp đối
 * chiếu của ca "đổi setting rồi chốt lại thì tiền KHÔNG đổi" ở
 * `finalize-snapshot.integration.test.ts` — hai ca đứng cạnh nhau mới chứng
 * minh cái van xả hoạt động đúng chiều.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  members,
  sessions,
  votes,
  sessionDebts,
  financialTransactions,
  appSettings,
  admins as adminsTable,
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

const { finalizeSessionAuto } = await import("./finance");
const { unlockSession } = await import("./sessions");

async function reset() {
  await client.execute("DELETE FROM payment_notifications");
  await client.execute("DELETE FROM financial_transactions");
  await client.execute("DELETE FROM session_min_deduction_exemptions");
  await client.execute("DELETE FROM session_debts");
  await client.execute("DELETE FROM session_attendees");
  await client.execute("DELETE FROM session_shuttlecocks");
  await client.execute("DELETE FROM votes");
  await client.execute("DELETE FROM sessions");
  await client.execute("DELETE FROM app_settings");
  await client.execute("DELETE FROM admins");
  await client.execute("DELETE FROM members");
}

async function setSetting(key: string, value: unknown) {
  await testDb
    .insert(appSettings)
    .values({ key, value: JSON.stringify(value) })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: JSON.stringify(value) },
    });
}

/** Đặt sàn khách-của-admin, thứ quyết định số tiền trong các ca dưới. */
async function setGuestAdminFloor(amount: number) {
  const base = defaultSettings().groupPolicies;
  await setSetting("groupPolicies", {
    ...base,
    guestAdmin: { mode: "floor", amount, capAtEqual: false },
  });
}

let dateCounter = 0;
async function seedFinalizedSession() {
  const inserted = await testDb
    .insert(members)
    .values([
      { name: "Admin", facebookId: `fb-admin-${dateCounter}` },
      { name: "A", facebookId: `fb-a-${dateCounter}` },
      { name: "B", facebookId: `fb-b-${dateCounter}` },
    ])
    .returning({ id: members.id });
  const [adminMember, a, b] = inserted;
  const [adminRow] = await testDb
    .insert(adminsTable)
    .values({ username: "Admin", passwordHash: "x", memberId: adminMember.id })
    .returning({ id: adminsTable.id });
  vi.mocked(requireAdmin).mockResolvedValue({
    admin: { sub: String(adminRow.id), role: "admin" },
  } as never);

  dateCounter += 1;
  const date = `2026-11-${String(dateCounter).padStart(2, "0")}`;
  const [s] = await testDb
    .insert(sessions)
    .values({
      date,
      status: "confirmed",
      // 150.000 chia 3 đầu = 50.000, THẤP hơn sàn khách-admin 60.000 nên sàn
      // mới thật sự bám và đẩy phần chênh sang A/B. Để 300.000 thì chia đều
      // đã ra 100.000 (cao hơn sàn), sàn không bám, đổi sàn cũng không đổi
      // tiền — bản đầu của test này sai đúng chỗ đó.
      courtPrice: 150_000,
      useMinDeduction: false,
      // Một khách của admin → sàn khách-admin quyết định phần còn lại chia cho
      // A và B, nên đổi sàn là đổi tiền của họ thấy rõ.
      adminGuestPlayCount: 1,
    })
    .returning({ id: sessions.id });

  for (const m of [a, b]) {
    await testDb
      .insert(votes)
      .values({ sessionId: s.id, memberId: m.id, willPlay: true });
  }

  const r = await finalizeSessionAuto(s.id);
  expect(r).not.toHaveProperty("error");
  return { sessionId: s.id, aId: a.id, bId: b.id };
}

async function snapshotOf(sessionId: number) {
  const row = await testDb.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
  });
  return row?.settingsSnapshot ?? null;
}

async function debtOf(sessionId: number, memberId: number) {
  const rows = await testDb.query.sessionDebts.findMany({
    where: eq(sessionDebts.sessionId, sessionId),
  });
  return rows.find((r) => r.memberId === memberId)?.totalAmount ?? null;
}

describe("mở lại buổi + bỏ đóng băng cấu hình", () => {
  beforeEach(async () => {
    await reset();
    await setGuestAdminFloor(60_000);
  });

  it("KHÔNG truyền cờ: snapshot giữ nguyên (hành vi production hiện tại)", async () => {
    const { sessionId } = await seedFinalizedSession();
    const before = await snapshotOf(sessionId);
    expect(before).not.toBeNull();

    const r = await unlockSession(sessionId);
    expect(r).not.toHaveProperty("error");

    expect(await snapshotOf(sessionId)).toBe(before);
    const row = await testDb.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });
    expect(row?.status).toBe("voting");
  });

  it("truyền cờ true: snapshot về null, status vẫn đổi đúng", async () => {
    const { sessionId } = await seedFinalizedSession();
    expect(await snapshotOf(sessionId)).not.toBeNull();

    const r = await unlockSession(sessionId, true);
    expect(r).not.toHaveProperty("error");

    expect(await snapshotOf(sessionId)).toBeNull();
    const row = await testDb.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });
    expect(row?.status).toBe("voting");
  });

  it("bỏ đóng băng rồi chốt lại: tiền tính theo cấu hình HIỆN TẠI", async () => {
    const { sessionId, aId } = await seedFinalizedSession();
    const firstAmount = await debtOf(sessionId, aId);
    // 150.000, khách-admin trả sàn 60.000 → A và B chia 90.000 = 45.000 mỗi người.
    expect(firstAmount).toBe(45_000);

    // Admin nâng sàn khách-admin lên 100.000.
    await setGuestAdminFloor(100_000);

    await unlockSession(sessionId, true);
    const r = await finalizeSessionAuto(sessionId);
    expect(r).not.toHaveProperty("error");

    // Giờ khách-admin gánh 100.000 → A và B chia 50.000 = 25.000 mỗi người.
    expect(await debtOf(sessionId, aId)).toBe(25_000);
  });

  it("GIỮ đóng băng rồi chốt lại: tiền KHÔNG đổi dù setting đã đổi", async () => {
    const { sessionId, aId } = await seedFinalizedSession();
    expect(await debtOf(sessionId, aId)).toBe(45_000);

    await setGuestAdminFloor(100_000);

    // Mở lại mà KHÔNG tích ô → snapshot còn nguyên → chốt lại dùng cấu hình cũ.
    await unlockSession(sessionId);
    const r = await finalizeSessionAuto(sessionId);
    expect(r).not.toHaveProperty("error");

    expect(await debtOf(sessionId, aId)).toBe(45_000);
  });

  it("sau khi tính lại, Σ trừ quỹ vẫn khớp Σ nợ (trừ nợ của admin)", async () => {
    const { sessionId } = await seedFinalizedSession();
    await setGuestAdminFloor(100_000);
    await unlockSession(sessionId, true);
    await finalizeSessionAuto(sessionId);

    const adminRow = await testDb.query.admins.findFirst();
    const adminMemberId = adminRow?.memberId ?? -1;

    const debts = await testDb.query.sessionDebts.findMany({
      where: eq(sessionDebts.sessionId, sessionId),
    });
    const txs = await testDb.query.financialTransactions.findMany({
      where: eq(financialTransactions.sessionId, sessionId),
    });
    // Chỉ tính dòng trừ quỹ CHƯA bị đảo (mở lại buổi sinh ra cặp đảo cho lần
    // chốt trước; cộng cả cặp đó vào là so sai).
    const reversedIds = new Set(
      txs.map((t) => t.reversalOfId).filter((x): x is number => x !== null),
    );
    const deductions = txs.filter(
      (t) =>
        t.type === "fund_deduction" &&
        t.reversalOfId === null &&
        !reversedIds.has(t.id),
    );
    const sumDebt = debts
      .filter((d) => d.memberId !== adminMemberId)
      .reduce((n, d) => n + d.totalAmount, 0);
    const sumDeduction = deductions.reduce((n, t) => n + t.amount, 0);
    expect(sumDeduction).toBe(sumDebt);
  });
});

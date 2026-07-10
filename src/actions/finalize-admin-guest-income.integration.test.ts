/**
 * Integration tests: tiền khách của admin được cộng vào quỹ dưới dạng
 * `session_guest_income` (thu nhóm, memberId=null) khi chốt buổi.
 *
 * Quyết định 2026-07-10: khách của admin trả sàn 60K, khoản đó KHÔNG trừ/cộng
 * vào balance member nào (kể cả Châu) mà vào "quỹ chung". Report quỹ đếm nó vào
 * "Thu" nên buổi không còn hiển thị lỗ giả.
 *
 * Spec: docs/superpowers/specs/2026-07-10-admin-guest-fund-income-design.md
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  members,
  sessions,
  admins as adminsTable,
  financialTransactions,
} from "@/db/schema";
import { eq } from "drizzle-orm";

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
const { getSessionFinanceReport } = await import("./fund");

async function reset() {
  await client.execute("DELETE FROM payment_notifications");
  await client.execute("DELETE FROM financial_transactions");
  await client.execute("DELETE FROM session_debts");
  await client.execute("DELETE FROM session_attendees");
  await client.execute("DELETE FROM session_shuttlecocks");
  await client.execute("DELETE FROM votes");
  await client.execute("DELETE FROM sessions");
  await client.execute("DELETE FROM admins");
  await client.execute("DELETE FROM members");
}

async function seed() {
  const [admin, alice, bob] = await testDb
    .insert(members)
    .values([
      { name: "Chau", facebookId: "fb-admin" },
      { name: "Alice", facebookId: "fb-a" },
      { name: "Bob", facebookId: "fb-b" },
    ])
    .returning({ id: members.id });
  const [adminRow] = await testDb
    .insert(adminsTable)
    .values({ username: "Chau", passwordHash: "x", memberId: admin.id })
    .returning({ id: adminsTable.id });
  vi.mocked(requireAdmin).mockResolvedValue({
    admin: { sub: String(adminRow.id), role: "admin" },
  } as never);
  return { adminId: admin.id, aliceId: alice.id, bobId: bob.id };
}

/**
 * Buổi: courtPrice 200K, 3 member chơi (Chau/Alice/Bob) + 1 khách admin.
 * totalPlayers=4 → naive 50K < 60K floor → khách admin trả sàn 60K, nhóm
 * chia đều splitCost=(200-60)/3 → 47K/người.
 *  - fund_deduction: Chau 47K, Alice 47K, Bob 47K = 141K
 *  - session_guest_income: 60K (khách admin) → vào quỹ chung
 *  - chi=200K, thu=141K+60K=201K → loi +1K (không lỗ)
 */
async function seedAndFinalize(
  adminId: number,
  aliceId: number,
  bobId: number,
) {
  const [s] = await testDb
    .insert(sessions)
    .values({
      date: "2026-06-10",
      status: "confirmed",
      courtPrice: 200_000,
      adminGuestPlayCount: 1,
      adminGuestDineCount: 0,
      // Tắt sàn 60K member-poverty để test cô lập đúng hành vi thu khách-admin
      // (floor có test riêng). Members chia đều 47K, không bị nâng lên 60K.
      useMinDeduction: false,
    })
    .returning({ id: sessions.id });

  const r = await finalizeSession(
    s.id,
    [
      {
        memberId: adminId,
        guestName: null,
        invitedById: null,
        isGuest: false,
        attendsPlay: true,
        attendsDine: false,
      },
      {
        memberId: aliceId,
        guestName: null,
        invitedById: null,
        isGuest: false,
        attendsPlay: true,
        attendsDine: false,
      },
      {
        memberId: bobId,
        guestName: null,
        invitedById: null,
        isGuest: false,
        attendsPlay: true,
        attendsDine: false,
      },
      {
        memberId: null,
        guestName: "Khach Admin 1",
        invitedById: adminId,
        isGuest: true,
        attendsPlay: true,
        attendsDine: false,
      },
    ],
    0,
  );
  expect("error" in r).toBe(false);
  return s.id;
}

describe("finalizeSession — admin guest income into fund", () => {
  beforeEach(reset);

  it("records a session_guest_income (memberId=null) for the admin guest, NOT on any member balance", async () => {
    const { adminId, aliceId, bobId } = await seed();
    const sessionId = await seedAndFinalize(adminId, aliceId, bobId);

    const all = await testDb.query.financialTransactions.findMany({
      where: eq(financialTransactions.sessionId, sessionId),
    });

    // The admin-guest 60K is recorded as group income, not attributed to anyone.
    const income = all.filter((t) => t.type === "session_guest_income");
    expect(income).toHaveLength(1);
    expect(income[0].amount).toBe(60_000);
    expect(income[0].memberId).toBeNull();
    expect(income[0].direction).toBe("in");

    // Admin (Chau) is charged ONLY own play (47K); the 60K guest is NOT on Chau.
    const adminDeductions = all.filter(
      (t) => t.type === "fund_deduction" && t.memberId === adminId,
    );
    const adminDeducted = adminDeductions.reduce((s, t) => s + t.amount, 0);
    expect(adminDeducted).toBe(47_000);

    // No fund_deduction / fund_contribution anywhere equals the 60K guest amount
    // (i.e. the guest amount never lands on a member balance).
    const guestSizedFundRows = all.filter(
      (t) =>
        (t.type === "fund_deduction" || t.type === "fund_contribution") &&
        t.amount === 60_000,
    );
    expect(guestSizedFundRows).toHaveLength(0);
  });

  it("keeps member balances = Σ fund_deduction (guest income does NOT touch balances / I1 holds)", async () => {
    const { adminId, aliceId, bobId } = await seed();
    await seedAndFinalize(adminId, aliceId, bobId);

    const all = await testDb.query.financialTransactions.findMany();
    // Per-member balance = contributions − deductions − refunds (fund_* only).
    const bal = (mid: number) =>
      all
        .filter((t) => t.memberId === mid)
        .reduce((s, t) => {
          if (t.type === "fund_contribution") return s + t.amount;
          if (t.type === "fund_deduction") return s - t.amount;
          if (t.type === "fund_refund") return s - t.amount;
          return s;
        }, 0);

    expect(bal(adminId)).toBe(-47_000);
    expect(bal(aliceId)).toBe(-47_000);
    expect(bal(bobId)).toBe(-47_000);

    // I1: net over fund_* types == Σ per-member balances.
    let netInternal = 0;
    for (const t of all) {
      if (t.reversalOfId != null) continue;
      if (t.type === "fund_contribution") netInternal += t.amount;
      else if (t.type === "fund_deduction") netInternal -= t.amount;
      else if (t.type === "fund_refund") netInternal -= t.amount;
    }
    const netByMembers = bal(adminId) + bal(aliceId) + bal(bobId);
    expect(netInternal).toBe(netByMembers);
  });

  it("getSessionFinanceReport counts guest income in Thu → session is NOT a loss", async () => {
    const { adminId, aliceId, bobId } = await seed();
    const sessionId = await seedAndFinalize(adminId, aliceId, bobId);

    const report = await getSessionFinanceReport();
    const entry = report.find((e) => e.sessionId === sessionId);
    expect(entry).toBeDefined();
    expect(entry!.chi).toBe(200_000);
    // Thu = 3×47K (deductions) + 60K (guest income) = 201K
    expect(entry!.thu).toBe(201_000);
    expect(entry!.loi).toBe(1_000);
  });

  it("re-finalize does NOT double the guest income (old reversed, new inserted)", async () => {
    const { adminId, aliceId, bobId } = await seed();
    const sessionId = await seedAndFinalize(adminId, aliceId, bobId);

    // Re-finalize with the identical payload.
    const r2 = await finalizeSession(
      sessionId,
      [
        {
          memberId: adminId,
          guestName: null,
          invitedById: null,
          isGuest: false,
          attendsPlay: true,
          attendsDine: false,
        },
        {
          memberId: aliceId,
          guestName: null,
          invitedById: null,
          isGuest: false,
          attendsPlay: true,
          attendsDine: false,
        },
        {
          memberId: bobId,
          guestName: null,
          invitedById: null,
          isGuest: false,
          attendsPlay: true,
          attendsDine: false,
        },
        {
          memberId: null,
          guestName: "Khach Admin 1",
          invitedById: adminId,
          isGuest: true,
          attendsPlay: true,
          attendsDine: false,
        },
      ],
      0,
    );
    expect("error" in r2).toBe(false);

    const all = await testDb.query.financialTransactions.findMany({
      where: eq(financialTransactions.sessionId, sessionId),
    });
    const income = all.filter((t) => t.type === "session_guest_income");
    const voided = new Set(
      income.filter((t) => t.reversalOfId != null).map((t) => t.reversalOfId),
    );
    const activeIncome = income
      .filter((t) => t.reversalOfId == null && !voided.has(t.id))
      .reduce((s, t) => s + t.amount, 0);
    expect(activeIncome).toBe(60_000); // NOT 120_000

    // Report still shows +1K, not inflated.
    const report = await getSessionFinanceReport();
    const entry = report.find((e) => e.sessionId === sessionId);
    expect(entry!.thu).toBe(201_000);
    expect(entry!.loi).toBe(1_000);
  });
});

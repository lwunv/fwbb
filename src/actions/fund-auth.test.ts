/**
 * Security tests cho fund query/mutation actions.
 *
 * Audit phát hiện hàng loạt action `"use server"` trong fund.ts thiếu
 * authorization → bất kỳ ai (kể cả unauth) gọi được qua devtools để leak PII
 * và lịch sử quỹ. Sau fix:
 *
 *  - Admin-only: getFundMembers, getFundMembersWithBalances,
 *    getAllFundTransactions, getRecentFinancialTransactions, getFundOverview.
 *  - Member-or-admin: getFundTransactionsForMember(memberId) — chỉ cho phép
 *    chủ tài khoản hoặc admin.
 *
 * mergeLegacyDebtsIntoFund: chỉ admin được gọi (migration tool).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  members,
  fundMembers,
  financialTransactions,
  sessions,
  sessionDebts,
} from "@/db/schema";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const authMock = vi.hoisted(() => ({
  requireAdmin:
    vi.fn<
      () => Promise<
        { admin: { sub: string; role: string } } | { error: string }
      >
    >(),
  getAdminFromCookie: vi.fn<() => Promise<unknown>>(),
}));
vi.mock("@/lib/auth", () => authMock);

const userMock = vi.hoisted(() => ({
  getUserFromCookie:
    vi.fn<() => Promise<{ memberId: number; facebookId: string } | null>>(),
}));
vi.mock("@/lib/user-identity", () => userMock);

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const {
  getFundMembers,
  getFundMembersWithBalances,
  getFundTransactionsForMember,
  getAllFundTransactions,
  getRecentFinancialTransactions,
  getFundOverview,
} = await import("./fund");

const { mergeLegacyDebtsIntoFund } = await import("./merge-debt-fund");

async function reset() {
  await client.execute("DELETE FROM payment_notifications");
  await client.execute("DELETE FROM financial_transactions");
  await client.execute("DELETE FROM session_debts");
  await client.execute("DELETE FROM session_attendees");
  await client.execute("DELETE FROM session_shuttlecocks");
  await client.execute("DELETE FROM votes");
  await client.execute("DELETE FROM sessions");
  await client.execute("DELETE FROM fund_members");
  await client.execute("DELETE FROM members");
}

async function asAdmin() {
  authMock.requireAdmin.mockResolvedValue({
    admin: { sub: "1", role: "admin" },
  });
  authMock.getAdminFromCookie.mockResolvedValue({ sub: "1", role: "admin" });
}
async function asAnonymous() {
  authMock.requireAdmin.mockResolvedValue({ error: "Không có quyền admin" });
  authMock.getAdminFromCookie.mockResolvedValue(null);
  userMock.getUserFromCookie.mockResolvedValue(null);
}
async function asMember(id: number) {
  authMock.requireAdmin.mockResolvedValue({ error: "Không có quyền admin" });
  authMock.getAdminFromCookie.mockResolvedValue(null);
  userMock.getUserFromCookie.mockResolvedValue({
    memberId: id,
    facebookId: `fb-${id}`,
  });
}

async function seedMember(name: string, fbId: string) {
  const [m] = await testDb
    .insert(members)
    .values({ name, facebookId: fbId, bankAccountNo: "0123456789" })
    .returning({ id: members.id });
  await testDb.insert(fundMembers).values({ memberId: m.id, isActive: true });
  await testDb.insert(financialTransactions).values({
    type: "fund_contribution",
    direction: "in",
    amount: 100_000,
    memberId: m.id,
  });
  return m.id;
}

describe("fund queries — authorization", () => {
  beforeEach(async () => {
    await reset();
    authMock.requireAdmin.mockReset();
    authMock.getAdminFromCookie.mockReset();
    userMock.getUserFromCookie.mockReset();
  });

  describe("admin-only queries reject unauth callers", () => {
    it("getFundMembers returns [] for unauth", async () => {
      await seedMember("Alice", "fb-a");
      await asAnonymous();
      const r = await getFundMembers();
      expect(r).toEqual([]);
    });

    it("getFundMembersWithBalances returns [] for unauth", async () => {
      await seedMember("Alice", "fb-a");
      await asAnonymous();
      const r = await getFundMembersWithBalances();
      expect(r).toEqual([]);
    });

    it("getAllFundTransactions returns [] for unauth", async () => {
      await seedMember("Alice", "fb-a");
      await asAnonymous();
      const r = await getAllFundTransactions();
      expect(r).toEqual([]);
    });

    it("getRecentFinancialTransactions returns [] for unauth", async () => {
      await seedMember("Alice", "fb-a");
      await asAnonymous();
      const r = await getRecentFinancialTransactions();
      expect(r).toEqual([]);
    });

    it("getFundOverview returns empty totals for unauth", async () => {
      await seedMember("Alice", "fb-a");
      await asAnonymous();
      const r = await getFundOverview();
      expect(r.balances).toEqual([]);
      expect(r.totalBalance).toBe(0);
    });
  });

  describe("admin can access", () => {
    it("admin sees full data", async () => {
      const a = await seedMember("Alice", "fb-a");
      await asAdmin();

      const members = await getFundMembersWithBalances();
      expect(members.length).toBeGreaterThan(0);
      expect(members[0].memberId).toBe(a);

      const all = await getAllFundTransactions();
      expect(all.length).toBeGreaterThan(0);
    });
  });

  describe("getFundTransactionsForMember — IDOR protection", () => {
    it("rejects when member tries to read another member's tx", async () => {
      const aliceId = await seedMember("Alice", "fb-a");
      const bobId = await seedMember("Bob", "fb-b");
      await asMember(bobId);

      const r = await getFundTransactionsForMember(aliceId);
      expect(r).toEqual([]);
    });

    it("allows the member to read their own tx", async () => {
      const aliceId = await seedMember("Alice", "fb-a");
      await asMember(aliceId);

      const r = await getFundTransactionsForMember(aliceId);
      expect(r.length).toBeGreaterThan(0);
      expect(r.every((t) => t.memberId === aliceId)).toBe(true);
    });

    it("admin can read any member's tx", async () => {
      const aliceId = await seedMember("Alice", "fb-a");
      await asAdmin();

      const r = await getFundTransactionsForMember(aliceId);
      expect(r.length).toBeGreaterThan(0);
    });

    it("rejects unauth completely", async () => {
      const aliceId = await seedMember("Alice", "fb-a");
      await asAnonymous();
      const r = await getFundTransactionsForMember(aliceId);
      expect(r).toEqual([]);
    });
  });
});

describe("mergeLegacyDebtsIntoFund — authorization", () => {
  beforeEach(async () => {
    await reset();
    authMock.requireAdmin.mockReset();
    userMock.getUserFromCookie.mockReset();
  });

  async function seedDebt(amount = 100_000) {
    const [m] = await testDb
      .insert(members)
      .values({ name: "X", facebookId: "fb-x" })
      .returning({ id: members.id });
    const [s] = await testDb
      .insert(sessions)
      .values({ date: "2026-04-01", status: "completed", courtPrice: 200_000 })
      .returning({ id: sessions.id });
    await testDb.insert(sessionDebts).values({
      sessionId: s.id,
      memberId: m.id,
      totalAmount: amount,
      memberConfirmed: false,
      adminConfirmed: false,
    });
    return { memberId: m.id, sessionId: s.id };
  }

  it("rejects unauthenticated callers", async () => {
    await seedDebt();
    await asAnonymous();

    const r = await mergeLegacyDebtsIntoFund();
    expect("error" in r).toBe(true);
    if ("error" in r) return;
    expect(r.migratedCount).toBe(0);

    const txs = await testDb.query.financialTransactions.findMany();
    expect(txs).toHaveLength(0);
  });

  it("rejects logged-in member who is not admin", async () => {
    await seedDebt();
    await asMember(1);
    const r = await mergeLegacyDebtsIntoFund();
    expect("error" in r).toBe(true);
  });

  it("admin can run the migration", async () => {
    await seedDebt(50_000);
    await asAdmin();

    const r = await mergeLegacyDebtsIntoFund();
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.migratedCount).toBe(1);
    expect(r.totalAmount).toBe(50_000);
  });
});

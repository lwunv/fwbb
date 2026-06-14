/**
 * getMemberFinanceOverview phải tính "còn nợ"/"còn quỹ" từ LEDGER balance
 * (single source), KHÔNG suy từ cờ memberConfirmed/adminConfirmed — vì trong
 * merged Quỹ+Nợ model 2 cờ này chỉ còn nghĩa "đã ghi ledger" (finalize/auto/
 * bank đều set =true ngay), nên bucket theo cờ làm mọi nợ rơi vào "đã trả".
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  members,
  sessions,
  sessionDebts,
  financialTransactions,
} from "@/db/schema";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { getMemberFinanceOverview } = await import("./finance");

async function reset() {
  await client.execute("DELETE FROM financial_transactions");
  await client.execute("DELETE FROM session_debts");
  await client.execute("DELETE FROM sessions");
  await client.execute("DELETE FROM members");
}

describe("getMemberFinanceOverview — ledger-based", () => {
  beforeEach(reset);

  it("còn nợ = balance âm từ ledger, KHÔNG theo cờ adminConfirmed", async () => {
    const [alice] = await testDb
      .insert(members)
      .values({ name: "Alice", facebookId: "fb-a" })
      .returning({ id: members.id });
    const [s] = await testDb
      .insert(sessions)
      .values({ date: "2026-04-20", status: "completed", courtPrice: 100_000 })
      .returning({ id: sessions.id });
    // Debt đã set adminConfirmed=true (theo merged model: "đã ghi ledger").
    await testDb.insert(sessionDebts).values({
      sessionId: s.id,
      memberId: alice.id,
      totalAmount: 100_000,
      memberConfirmed: true,
      adminConfirmed: true,
    });
    // Nhưng ledger: chỉ có fund_deduction 100k → balance = -100k (CÒN NỢ thật).
    await testDb.insert(financialTransactions).values({
      type: "fund_deduction",
      direction: "out",
      amount: 100_000,
      memberId: alice.id,
      sessionId: s.id,
      idempotencyKey: "ded-1",
    });

    const rows = await getMemberFinanceOverview();
    const row = rows.find((r) => r.memberId === alice.id)!;
    // Ledger-based: Alice CÒN NỢ 100k (không phải "đã trả").
    expect(row.totalOutstanding).toBe(100_000);
    expect(row.totalPaid).toBe(0);
  });

  it("còn quỹ = balance dương từ ledger", async () => {
    const [bob] = await testDb
      .insert(members)
      .values({ name: "Bob", facebookId: "fb-b" })
      .returning({ id: members.id });
    await testDb.insert(financialTransactions).values({
      type: "fund_contribution",
      direction: "in",
      amount: 300_000,
      memberId: bob.id,
      idempotencyKey: "con-1",
    });

    const rows = await getMemberFinanceOverview();
    const row = rows.find((r) => r.memberId === bob.id)!;
    expect(row.totalOutstanding).toBe(0);
    expect(row.totalPaid).toBe(300_000);
  });
});

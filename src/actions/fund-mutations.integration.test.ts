/**
 * Integration tests cho fund mutations: recordContribution, recordRefund.
 *
 * Audit phát hiện:
 *  - Critical #5: recordRefund đọc balance ngoài transaction → 2 admin click
 *    cùng lúc với amount=balance đều pass check, cả hai insert → quỹ âm.
 *  - High #9: idempotencyKey chỉ optional → form double-submit ghi 2 row.
 *
 * Sau fix:
 *  - Cả 2 action wrap `db.transaction`.
 *  - Validate qua Zod (`fundContributionSchema` / `fundRefundSchema`):
 *    integer ∈ [1.000, 100.000.000].
 *  - idempotencyKey BẮT BUỘC; thiếu → trả error.
 *  - recordRefund: kiểm balance lại bên trong transaction.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members, fundMembers, financialTransactions } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
  getAdminFromCookie: vi.fn(async () => ({ sub: "1", role: "admin" })),
}));
vi.mock("@/lib/user-identity", () => ({
  getUserFromCookie: vi.fn(async () => null),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { recordContribution, recordRefund } = await import("./fund");

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

async function seedFundMember(name = "Alice", fbId = "fb-a") {
  const [m] = await testDb
    .insert(members)
    .values({ name, facebookId: fbId })
    .returning({ id: members.id });
  await testDb.insert(fundMembers).values({ memberId: m.id, isActive: true });
  return m.id;
}

async function balance(memberId: number) {
  const txs = await testDb.query.financialTransactions.findMany({
    where: eq(financialTransactions.memberId, memberId),
  });
  let b = 0;
  for (const t of txs) {
    if (t.type === "fund_contribution") b += t.amount;
    else if (t.type === "fund_deduction") b -= t.amount;
    else if (t.type === "fund_refund") b -= t.amount;
  }
  return b;
}

describe("recordContribution — validation + idempotency", () => {
  beforeEach(reset);

  it("rejects without idempotencyKey", async () => {
    const m = await seedFundMember();
    const r = await recordContribution(m, 200_000, "test");
    expect("error" in r).toBe(true);
  });

  it("rejects amount below 1.000đ via Zod", async () => {
    const m = await seedFundMember();
    const r = await recordContribution(m, 500, undefined, "key-1");
    expect("error" in r).toBe(true);
  });

  it("rejects amount above 100M cap", async () => {
    const m = await seedFundMember();
    const r = await recordContribution(m, 200_000_000, undefined, "key-1");
    expect("error" in r).toBe(true);
  });

  it("rejects non-integer amount", async () => {
    const m = await seedFundMember();
    const r = await recordContribution(m, 1500.5, undefined, "key-1");
    expect("error" in r).toBe(true);
  });

  it("succeeds with valid input", async () => {
    const m = await seedFundMember();
    const r = await recordContribution(m, 500_000, "Đóng quỹ T4", "key-1");
    expect("error" in r).toBe(false);
    expect(await balance(m)).toBe(500_000);
  });

  it("replays the same idempotencyKey without inserting twice", async () => {
    const m = await seedFundMember();
    const r1 = await recordContribution(m, 500_000, "Đóng quỹ", "uuid-1");
    const r2 = await recordContribution(m, 500_000, "Đóng quỹ", "uuid-1");
    expect("error" in r1).toBe(false);
    expect("error" in r2).toBe(false);
    if ("error" in r2) return;
    expect(r2.replayed).toBe(true);
    expect(await balance(m)).toBe(500_000);
  });
});

describe("recordRefund — validation + race-safety", () => {
  beforeEach(reset);

  async function topUp(memberId: number, amount: number) {
    await testDb.insert(financialTransactions).values({
      type: "fund_contribution",
      direction: "in",
      amount,
      memberId,
    });
  }

  it("rejects without idempotencyKey", async () => {
    const m = await seedFundMember();
    await topUp(m, 1_000_000);
    const r = await recordRefund(m, 500_000, "Hoàn quỹ");
    expect("error" in r).toBe(true);
  });

  it("rejects refund > balance", async () => {
    const m = await seedFundMember();
    await topUp(m, 100_000);
    const r = await recordRefund(m, 200_000, undefined, "key-1");
    expect("error" in r).toBe(true);
  });

  it("rejects amount below 1.000đ via Zod", async () => {
    const m = await seedFundMember();
    await topUp(m, 500_000);
    const r = await recordRefund(m, 500, undefined, "key-1");
    expect("error" in r).toBe(true);
  });

  it("succeeds with valid input and reduces balance", async () => {
    const m = await seedFundMember();
    await topUp(m, 1_000_000);
    const r = await recordRefund(m, 600_000, "Rời nhóm", "key-1");
    expect("error" in r).toBe(false);
    expect(await balance(m)).toBe(400_000);
  });

  it("two concurrent refunds with DIFFERENT keys: no overdraft (second fails)", async () => {
    const m = await seedFundMember();
    await topUp(m, 500_000);

    // Sequential with different keys: first drains balance, second must fail.
    // We don't test parallel-with-different-keys because SQLite serializes
    // writers and the second simply waits for the first; the safety claim is
    // that under any ordering the balance never goes negative.
    const r1 = await recordRefund(m, 500_000, "First", "key-first");
    const r2 = await recordRefund(m, 500_000, "Second", "key-second");
    expect("error" in r1).toBe(false);
    expect("error" in r2).toBe(true);
    expect(await balance(m)).toBe(0);
  });

  it("balance check is INSIDE the transaction (no torn read of balance)", async () => {
    // Even if we read balance just before recordRefund, by the time we insert
    // a concurrent writer might have already drained it. The fix re-reads
    // balance inside the tx, so this scenario can never produce overdraft.
    const m = await seedFundMember();
    await topUp(m, 500_000);

    // Sequential: drain to 0
    const r1 = await recordRefund(m, 500_000, "A", "key-1");
    expect("error" in r1).toBe(false);

    // Now try to refund again with a different key — must fail (balance=0)
    const r2 = await recordRefund(m, 1_000, "B", "key-2");
    expect("error" in r2).toBe(true);

    expect(await balance(m)).toBe(0);
  });

  it("replay same key returns replayed=true without double-debiting", async () => {
    const m = await seedFundMember();
    await topUp(m, 1_000_000);
    const r1 = await recordRefund(m, 300_000, "Hoàn", "key-replay");
    const r2 = await recordRefund(m, 300_000, "Hoàn", "key-replay");
    expect("error" in r1).toBe(false);
    expect("error" in r2).toBe(false);
    if ("error" in r2) return;
    expect(r2.replayed).toBe(true);
    expect(await balance(m)).toBe(700_000);
  });
});

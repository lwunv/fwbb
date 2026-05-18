/**
 * Integration tests for member actions (HIGH+MEDIUM gaps per audit):
 *  - removeFundMember: refund positive balance atomically, flip isActive,
 *    handle negative balance (no refund issued), idempotent re-remove
 *  - findDuplicateMembers: detects name collisions, computes balance per
 *    duplicate via computeBalanceFromTransactions (no double-count of
 *    bank_payment_received audit rows)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  admins,
  members,
  fundMembers,
  financialTransactions,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { removeFundMember } = await import("./fund");
const { findDuplicateMembers } = await import("./members");

async function reset() {
  await client.execute("DELETE FROM financial_transactions");
  await client.execute("DELETE FROM fund_members");
  await client.execute("DELETE FROM admins");
  await client.execute("DELETE FROM members");
}

async function seedMember(name: string, fid = `fb-${name}-${Date.now()}`) {
  const [m] = await testDb
    .insert(members)
    .values({ name, facebookId: fid })
    .returning({ id: members.id });
  return m.id;
}

async function seedFundMember(memberId: number) {
  await testDb.insert(fundMembers).values({
    memberId,
    isActive: true,
    joinedAt: new Date().toISOString(),
  });
}

async function seedAdmin() {
  await testDb
    .insert(admins)
    .values({ username: `a${Date.now()}`, passwordHash: "hash" });
}

describe("removeFundMember (integration)", () => {
  beforeEach(async () => {
    await reset();
    await seedAdmin();
  });

  it("rejects when member not in fund", async () => {
    const memberId = await seedMember("Solo");
    const r = await removeFundMember(memberId);
    expect("error" in r).toBe(true);
  });

  it("removes with no balance — flips isActive=false, no refund tx", async () => {
    const memberId = await seedMember("Empty");
    await seedFundMember(memberId);

    const r = await removeFundMember(memberId);
    expect(r).toEqual({ success: true });

    const fm = await testDb.query.fundMembers.findFirst({
      where: eq(fundMembers.memberId, memberId),
    });
    expect(fm?.isActive).toBe(false);
    expect(fm?.leftAt).toBeTruthy();

    const refunds = await testDb.query.financialTransactions.findMany({
      where: and(
        eq(financialTransactions.memberId, memberId),
        eq(financialTransactions.type, "fund_refund"),
      ),
    });
    expect(refunds).toHaveLength(0);
  });

  it("positive balance — issues fund_refund + flips isActive (atomic)", async () => {
    const memberId = await seedMember("Positive");
    await seedFundMember(memberId);
    // Seed 100k contribution
    await testDb.insert(financialTransactions).values({
      memberId,
      type: "fund_contribution",
      direction: "in",
      amount: 100_000,
      idempotencyKey: `seed-contrib-${memberId}`,
    });

    const r = await removeFundMember(memberId);
    expect(r).toEqual({ success: true });

    const refunds = await testDb.query.financialTransactions.findMany({
      where: and(
        eq(financialTransactions.memberId, memberId),
        eq(financialTransactions.type, "fund_refund"),
      ),
    });
    expect(refunds).toHaveLength(1);
    expect(refunds[0].amount).toBe(100_000);
    expect(refunds[0].direction).toBe("out");
    // Natural-keyed by fundMembers.id
    expect(refunds[0].idempotencyKey?.startsWith("leave-fund-refund-")).toBe(
      true,
    );

    const fm = await testDb.query.fundMembers.findFirst({
      where: eq(fundMembers.memberId, memberId),
    });
    expect(fm?.isActive).toBe(false);
  });

  it("negative balance (member owes fund) — no refund, just deactivates", async () => {
    const memberId = await seedMember("Negative");
    await seedFundMember(memberId);
    // Seed 50k deduction → balance = -50k
    await testDb.insert(financialTransactions).values({
      memberId,
      type: "fund_deduction",
      direction: "out",
      amount: 50_000,
      idempotencyKey: `seed-debt-${memberId}`,
    });

    const r = await removeFundMember(memberId);
    expect(r).toEqual({ success: true });

    const refunds = await testDb.query.financialTransactions.findMany({
      where: and(
        eq(financialTransactions.memberId, memberId),
        eq(financialTransactions.type, "fund_refund"),
      ),
    });
    expect(refunds).toHaveLength(0);

    const fm = await testDb.query.fundMembers.findFirst({
      where: eq(fundMembers.memberId, memberId),
    });
    expect(fm?.isActive).toBe(false);
  });

  it("refundBalance=false — keeps balance, just deactivates", async () => {
    const memberId = await seedMember("KeepBalance");
    await seedFundMember(memberId);
    await testDb.insert(financialTransactions).values({
      memberId,
      type: "fund_contribution",
      direction: "in",
      amount: 80_000,
      idempotencyKey: `seed-contrib-${memberId}`,
    });

    const r = await removeFundMember(memberId, false);
    expect(r).toEqual({ success: true });

    const refunds = await testDb.query.financialTransactions.findMany({
      where: and(
        eq(financialTransactions.memberId, memberId),
        eq(financialTransactions.type, "fund_refund"),
      ),
    });
    expect(refunds).toHaveLength(0);
  });

  it("idempotent — second remove on already-removed member rejects (no double-refund)", async () => {
    const memberId = await seedMember("Twice");
    await seedFundMember(memberId);
    await testDb.insert(financialTransactions).values({
      memberId,
      type: "fund_contribution",
      direction: "in",
      amount: 60_000,
      idempotencyKey: `seed-contrib-${memberId}`,
    });

    const r1 = await removeFundMember(memberId);
    expect(r1).toEqual({ success: true });

    // Second call: member's fundMembers row is now isActive=false → rejects
    const r2 = await removeFundMember(memberId);
    expect("error" in r2).toBe(true);

    // Still only 1 refund
    const refunds = await testDb.query.financialTransactions.findMany({
      where: and(
        eq(financialTransactions.memberId, memberId),
        eq(financialTransactions.type, "fund_refund"),
      ),
    });
    expect(refunds).toHaveLength(1);
  });

  it("ignores audit-only rows (bank_payment_received) when computing balance", async () => {
    const memberId = await seedMember("Audit");
    await seedFundMember(memberId);
    // Contribution = real money in
    await testDb.insert(financialTransactions).values({
      memberId,
      type: "fund_contribution",
      direction: "in",
      amount: 80_000,
      idempotencyKey: `c1-${memberId}`,
    });
    // Audit row paired with contribution (bank webhook). MUST NOT double-count.
    await testDb.insert(financialTransactions).values({
      memberId,
      type: "bank_payment_received",
      direction: "in",
      amount: 80_000,
      idempotencyKey: `bank-${memberId}`,
    });

    const r = await removeFundMember(memberId);
    expect(r).toEqual({ success: true });

    // Refund = 80k (not 160k — bank row is audit-only, excluded from balance)
    const refunds = await testDb.query.financialTransactions.findMany({
      where: and(
        eq(financialTransactions.memberId, memberId),
        eq(financialTransactions.type, "fund_refund"),
      ),
    });
    expect(refunds).toHaveLength(1);
    expect(refunds[0].amount).toBe(80_000);
  });
});

describe("findDuplicateMembers (integration)", () => {
  beforeEach(async () => {
    await reset();
    await seedAdmin();
  });

  it("returns [] when no duplicates", async () => {
    await seedMember("A");
    await seedMember("B");
    await seedMember("C");

    const dups = await findDuplicateMembers();
    expect(dups).toEqual([]);
  });

  it("detects exact-name duplicates (case-insensitive, trimmed)", async () => {
    await seedMember("Nguyễn A");
    await seedMember("  nguyễn a  "); // same after trim+lower
    await seedMember("Different");

    const dups = await findDuplicateMembers();
    expect(dups).toHaveLength(1);
    expect(dups[0].members).toHaveLength(2);
    const names = dups[0].members.map((m) => m.name).sort();
    expect(names[0].toLowerCase().trim()).toBe("nguyễn a");
  });

  it("groups multiple duplicate clusters separately", async () => {
    await seedMember("Anh", "fb-anh1");
    await seedMember("Anh", "fb-anh2");
    await seedMember("Bình", "fb-binh1");
    await seedMember("Bình", "fb-binh2");
    await seedMember("Solo", "fb-solo");

    const dups = await findDuplicateMembers();
    expect(dups).toHaveLength(2);
    expect(dups.every((g) => g.members.length === 2)).toBe(true);
  });

  it("computes balance via canonical helper — bank audit rows excluded", async () => {
    const a1 = await seedMember("Dup", "fb-dup1");
    const a2 = await seedMember("Dup", "fb-dup2");
    // a1 has real contribution + paired audit row
    await testDb.insert(financialTransactions).values({
      memberId: a1,
      type: "fund_contribution",
      direction: "in",
      amount: 100_000,
      idempotencyKey: `c1-${a1}`,
    });
    await testDb.insert(financialTransactions).values({
      memberId: a1,
      type: "bank_payment_received",
      direction: "in",
      amount: 100_000,
      idempotencyKey: `bank-${a1}`,
    });
    // a2 has only a deduction → owing
    await testDb.insert(financialTransactions).values({
      memberId: a2,
      type: "fund_deduction",
      direction: "out",
      amount: 30_000,
      idempotencyKey: `d1-${a2}`,
    });

    const dups = await findDuplicateMembers();
    expect(dups).toHaveLength(1);
    const byId = new Map(dups[0].members.map((m) => [m.id, m]));
    // a1 balance = 100k (audit not double-counted)
    expect(byId.get(a1)?.balance).toBe(100_000);
    // a2 balance = -30k
    expect(byId.get(a2)?.balance).toBe(-30_000);
  });

  it("excludes reversal pairs from balance (reconcile invariant)", async () => {
    const a1 = await seedMember("Pair", "fb-p1");
    const a2 = await seedMember("Pair", "fb-p2");
    // a1: contribution then reversed
    const [orig] = await testDb
      .insert(financialTransactions)
      .values({
        memberId: a1,
        type: "fund_contribution",
        direction: "in",
        amount: 50_000,
        idempotencyKey: `orig-${a1}`,
      })
      .returning({ id: financialTransactions.id });
    await testDb.insert(financialTransactions).values({
      memberId: a1,
      type: "fund_refund",
      direction: "out",
      amount: 50_000,
      reversalOfId: orig.id,
      idempotencyKey: `rev-${a1}`,
    });

    const dups = await findDuplicateMembers();
    expect(dups).toHaveLength(1);
    const a1Data = dups[0].members.find((m) => m.id === a1);
    // Reversal pair cancels → balance = 0 (not 50k, not -50k)
    expect(a1Data?.balance).toBe(0);
  });

  it("records ledgerCount accurately", async () => {
    const a1 = await seedMember("Counts", "fb-c1");
    const a2 = await seedMember("Counts", "fb-c2");
    // a1 has 3 ledger rows
    for (let i = 0; i < 3; i++) {
      await testDb.insert(financialTransactions).values({
        memberId: a1,
        type: "fund_contribution",
        direction: "in",
        amount: 10_000,
        idempotencyKey: `c-${a1}-${i}`,
      });
    }
    // a2 has 1
    await testDb.insert(financialTransactions).values({
      memberId: a2,
      type: "fund_contribution",
      direction: "in",
      amount: 5_000,
      idempotencyKey: `c-${a2}-0`,
    });

    const dups = await findDuplicateMembers();
    const byId = new Map(dups[0].members.map((m) => [m.id, m]));
    expect(byId.get(a1)?.ledgerCount).toBe(3);
    expect(byId.get(a2)?.ledgerCount).toBe(1);
  });
});

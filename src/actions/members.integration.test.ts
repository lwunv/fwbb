/**
 * Integration tests for member actions (HIGH+MEDIUM gaps per audit):
 *  - toggleMemberActive: locking a member = leaving the fund (roster derives
 *    from members.isActive). Balance is FROZEN — no auto fund_refund issued.
 *  - findDuplicateMembers: detects name collisions, computes balance per
 *    duplicate via computeBalanceFromTransactions (no double-count of
 *    bank_payment_received audit rows)
 *
 * NOTE: the `fund_members` table was dropped (migration 0013). Fund membership
 * is now derived: in-fund ⇔ members.isActive=true AND approvalStatus='approved'.
 * Members insert with those defaults, so a plain insert = in-fund. "Not in fund"
 * is now expressed via isActive=false (locked) or approvalStatus!='approved'.
 * The old addFundMember/removeFundMember actions were removed.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { admins, members, financialTransactions } from "@/db/schema";
import { and, eq } from "drizzle-orm";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { toggleMemberActive, findDuplicateMembers } = await import("./members");
const { getFundBalance } = await import("@/lib/fund-calculator");

async function reset() {
  await client.execute("DELETE FROM financial_transactions");
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

async function seedAdmin() {
  await testDb
    .insert(admins)
    .values({ username: `a${Date.now()}`, passwordHash: "hash" });
}

describe("toggleMemberActive (integration)", () => {
  beforeEach(async () => {
    await reset();
    await seedAdmin();
  });

  it("new member is in-fund by default (isActive=true)", async () => {
    const memberId = await seedMember("Default");
    const m = await testDb.query.members.findFirst({
      where: eq(members.id, memberId),
    });
    expect(m?.isActive).toBe(true);
    expect(m?.approvalStatus).toBe("approved");
  });

  it("locks an in-fund member — flips isActive=false (leaves fund)", async () => {
    const memberId = await seedMember("Lockable");

    const r = await toggleMemberActive(memberId);
    expect(r).toEqual({ success: true });

    const m = await testDb.query.members.findFirst({
      where: eq(members.id, memberId),
    });
    expect(m?.isActive).toBe(false);
  });

  it("toggle is reversible — relock then unlock restores in-fund state", async () => {
    const memberId = await seedMember("Reversible");

    await toggleMemberActive(memberId); // → false
    let m = await testDb.query.members.findFirst({
      where: eq(members.id, memberId),
    });
    expect(m?.isActive).toBe(false);

    await toggleMemberActive(memberId); // → true
    m = await testDb.query.members.findFirst({
      where: eq(members.id, memberId),
    });
    expect(m?.isActive).toBe(true);
  });

  it("locking a member with positive balance does NOT issue a fund_refund (balance frozen)", async () => {
    const memberId = await seedMember("Positive");
    // Seed 100k contribution → balance = +100k
    await testDb.insert(financialTransactions).values({
      memberId,
      type: "fund_contribution",
      direction: "in",
      amount: 100_000,
      idempotencyKey: `seed-contrib-${memberId}`,
    });

    const r = await toggleMemberActive(memberId);
    expect(r).toEqual({ success: true });

    // No auto-refund row inserted — balance is frozen in the ledger.
    const refunds = await testDb.query.financialTransactions.findMany({
      where: and(
        eq(financialTransactions.memberId, memberId),
        eq(financialTransactions.type, "fund_refund"),
      ),
    });
    expect(refunds).toHaveLength(0);

    // Balance unchanged (still readable for a locked member — frozen, not zeroed).
    const bal = await getFundBalance(memberId);
    expect(bal.balance).toBe(100_000);

    // Member is out of fund (isActive=false).
    const m = await testDb.query.members.findFirst({
      where: eq(members.id, memberId),
    });
    expect(m?.isActive).toBe(false);
  });

  it("locking a member who owes the fund does NOT issue any refund either", async () => {
    const memberId = await seedMember("Negative");
    // Seed 50k deduction → balance = -50k
    await testDb.insert(financialTransactions).values({
      memberId,
      type: "fund_deduction",
      direction: "out",
      amount: 50_000,
      idempotencyKey: `seed-debt-${memberId}`,
    });

    const r = await toggleMemberActive(memberId);
    expect(r).toEqual({ success: true });

    const refunds = await testDb.query.financialTransactions.findMany({
      where: and(
        eq(financialTransactions.memberId, memberId),
        eq(financialTransactions.type, "fund_refund"),
      ),
    });
    expect(refunds).toHaveLength(0);

    const bal = await getFundBalance(memberId);
    expect(bal.balance).toBe(-50_000);
  });

  it("rejects when member does not exist", async () => {
    const r = await toggleMemberActive(999_999);
    expect("error" in r).toBe(true);
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

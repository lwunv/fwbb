/**
 * Integration tests cho auto-fund:
 *  - autoApplyFundToDebts: tự trừ quỹ thanh toán nợ unpaid (oldest-first, full-only)
 *  - claimFundContribution: tạo manual pending notification
 *
 * Đảm bảo:
 *   - Idempotent — chạy 2 lần không double-deduct
 *   - Không động vào debt đã confirmed
 *   - Không deduct partial khi balance < debt.totalAmount kế tiếp
 *   - Không apply nếu member không phải fund member
 *   - Ghi đúng financial_transaction (fund_deduction, autoApplied=true, sessionId, debtId)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  members,
  fundMembers,
  sessions,
  sessionDebts,
  financialTransactions,
  paymentNotifications,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const userMock = vi.hoisted(() => ({
  getUserFromCookie:
    vi.fn<() => Promise<{ memberId: number; facebookId: string } | null>>(),
}));
vi.mock("@/lib/user-identity", () => userMock);

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { autoApplyFundToDebts, claimFundContribution } =
  await import("./auto-fund");

/** Helper: stub the cookie to act as `memberId`. Use before each claim call. */
function actAs(memberId: number, facebookId = `fb-${memberId}`) {
  userMock.getUserFromCookie.mockResolvedValue({ memberId, facebookId });
}

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

async function seedMember(name = "Alice", facebookId = "fb-1") {
  const [m] = await testDb
    .insert(members)
    .values({ name, facebookId })
    .returning({ id: members.id });
  return m.id;
}

async function joinFund(memberId: number) {
  await testDb.insert(fundMembers).values({ memberId, isActive: true });
}

async function contribute(memberId: number, amount: number) {
  await testDb.insert(financialTransactions).values({
    type: "fund_contribution",
    direction: "in",
    amount,
    memberId,
  });
}

async function seedSession(date = "2026-04-10") {
  const [s] = await testDb
    .insert(sessions)
    .values({ date, status: "completed", courtPrice: 200_000 })
    .returning({ id: sessions.id });
  return s.id;
}

async function seedDebt(
  sessionId: number,
  memberId: number,
  total: number,
  overrides?: { memberConfirmed?: boolean; adminConfirmed?: boolean },
) {
  const [d] = await testDb
    .insert(sessionDebts)
    .values({
      sessionId,
      memberId,
      totalAmount: total,
      memberConfirmed: overrides?.memberConfirmed ?? false,
      adminConfirmed: overrides?.adminConfirmed ?? false,
    })
    .returning({ id: sessionDebts.id });
  return d.id;
}

describe("autoApplyFundToDebts (integration)", () => {
  beforeEach(async () => {
    await reset();
  });

  it("returns no-op when member is not in fund", async () => {
    const m = await seedMember();
    const s = await seedSession();
    await seedDebt(s, m, 100_000);

    const r = await autoApplyFundToDebts(m);
    expect(r).toEqual({
      appliedCount: 0,
      appliedTotal: 0,
      remainingBalance: 0,
    });

    // No fund_deduction created, debt stays unconfirmed
    const txs = await testDb.query.financialTransactions.findMany({});
    expect(txs).toHaveLength(0);
    const d = await testDb.query.sessionDebts.findFirst({});
    expect(d?.memberConfirmed).toBe(false);
  });

  it("returns no-op when fund balance is 0 or negative", async () => {
    const m = await seedMember();
    await joinFund(m);
    const s = await seedSession();
    await seedDebt(s, m, 100_000);

    // No contributions → balance is 0
    const r = await autoApplyFundToDebts(m);
    expect(r.appliedCount).toBe(0);
    expect(r.appliedTotal).toBe(0);
  });

  it("does not touch confirmed debts", async () => {
    const m = await seedMember();
    await joinFund(m);
    await contribute(m, 1_000_000);
    const s = await seedSession();
    const debtId = await seedDebt(s, m, 100_000, {
      memberConfirmed: true,
      adminConfirmed: true,
    });

    const r = await autoApplyFundToDebts(m);
    expect(r.appliedCount).toBe(0);

    const after = await testDb.query.sessionDebts.findFirst({
      where: eq(sessionDebts.id, debtId),
    });
    expect(after?.memberConfirmed).toBe(true);
    // No fund_deduction recorded
    const deds = await testDb.query.financialTransactions.findMany({
      where: eq(financialTransactions.type, "fund_deduction"),
    });
    expect(deds).toHaveLength(0);
  });

  it("auto-applies oldest-first when balance covers all debts", async () => {
    const m = await seedMember();
    await joinFund(m);
    await contribute(m, 600_000);
    const s1 = await seedSession("2026-04-01");
    const s2 = await seedSession("2026-04-08");
    const s3 = await seedSession("2026-04-15");
    const d1 = await seedDebt(s1, m, 100_000);
    const d2 = await seedDebt(s2, m, 200_000);
    const d3 = await seedDebt(s3, m, 150_000);

    const r = await autoApplyFundToDebts(m);
    expect(r.appliedCount).toBe(3);
    expect(r.appliedTotal).toBe(450_000);
    expect(r.remainingBalance).toBe(150_000); // 600k - 450k

    // All debts confirmed both sides
    for (const id of [d1, d2, d3]) {
      const d = await testDb.query.sessionDebts.findFirst({
        where: eq(sessionDebts.id, id),
      });
      expect(d?.memberConfirmed).toBe(true);
      expect(d?.adminConfirmed).toBe(true);
      expect(d?.memberConfirmedAt).toBeTruthy();
      expect(d?.adminConfirmedAt).toBeTruthy();
    }

    // 3 fund_deductions, all autoApplied=true
    const deds = await testDb.query.financialTransactions.findMany({
      where: eq(financialTransactions.type, "fund_deduction"),
    });
    expect(deds).toHaveLength(3);
    for (const t of deds) {
      expect(t.direction).toBe("out");
      expect(t.memberId).toBe(m);
      const meta = JSON.parse(t.metadataJson!);
      expect(meta.autoApplied).toBe(true);
    }
  });

  it("stops at first debt that exceeds remaining balance (no partial deduction)", async () => {
    const m = await seedMember();
    await joinFund(m);
    await contribute(m, 250_000);
    const s1 = await seedSession("2026-04-01");
    const s2 = await seedSession("2026-04-08");
    const s3 = await seedSession("2026-04-15");
    const d1 = await seedDebt(s1, m, 100_000);
    const d2 = await seedDebt(s2, m, 200_000); // <-- 150k remaining < 200k → stop
    const d3 = await seedDebt(s3, m, 50_000); // not deducted even though balance >= 50k

    const r = await autoApplyFundToDebts(m);
    expect(r.appliedCount).toBe(1); // only d1
    expect(r.appliedTotal).toBe(100_000);
    expect(r.remainingBalance).toBe(150_000);

    // d1 confirmed, d2 + d3 untouched
    const d1row = await testDb.query.sessionDebts.findFirst({
      where: eq(sessionDebts.id, d1),
    });
    const d2row = await testDb.query.sessionDebts.findFirst({
      where: eq(sessionDebts.id, d2),
    });
    const d3row = await testDb.query.sessionDebts.findFirst({
      where: eq(sessionDebts.id, d3),
    });
    expect(d1row?.memberConfirmed).toBe(true);
    expect(d2row?.memberConfirmed).toBe(false);
    expect(d3row?.memberConfirmed).toBe(false);
  });

  it("is idempotent — second call after success is a no-op", async () => {
    const m = await seedMember();
    await joinFund(m);
    await contribute(m, 200_000);
    const s = await seedSession();
    await seedDebt(s, m, 100_000);

    const r1 = await autoApplyFundToDebts(m);
    expect(r1.appliedCount).toBe(1);

    const r2 = await autoApplyFundToDebts(m);
    expect(r2.appliedCount).toBe(0);
    expect(r2.appliedTotal).toBe(0);
    // Balance after first: 200k-100k = 100k
    expect(r2.remainingBalance).toBe(100_000);

    // Only 1 fund_deduction stored
    const deds = await testDb.query.financialTransactions.findMany({
      where: eq(financialTransactions.type, "fund_deduction"),
    });
    expect(deds).toHaveLength(1);
  });

  it("respects fund_refund and fund_deduction in balance computation", async () => {
    const m = await seedMember();
    await joinFund(m);
    await contribute(m, 500_000);
    // Manual deduction 150k + refund 50k → balance = 500-150-50 = 300k
    await testDb.insert(financialTransactions).values([
      {
        type: "fund_deduction",
        direction: "out",
        amount: 150_000,
        memberId: m,
      },
      {
        type: "fund_refund",
        direction: "out",
        amount: 50_000,
        memberId: m,
      },
    ]);

    const s1 = await seedSession("2026-04-10");
    const s2 = await seedSession("2026-04-20");
    await seedDebt(s1, m, 250_000); // covered
    await seedDebt(s2, m, 60_000); // exceeds remaining 50k → stop

    const r = await autoApplyFundToDebts(m);
    // 250k debt fits, then 50k remaining < 60k → stops
    expect(r.appliedCount).toBe(1);
    expect(r.appliedTotal).toBe(250_000);
    expect(r.remainingBalance).toBe(50_000);
  });

  it("processes only the requested member's debts/balance", async () => {
    const a = await seedMember("Alice", "fb-a");
    const b = await seedMember("Bob", "fb-b");
    await joinFund(a);
    await joinFund(b);
    await contribute(a, 300_000);
    await contribute(b, 100_000);
    const s = await seedSession();
    await seedDebt(s, a, 100_000);
    await seedDebt(s, b, 100_000);

    const ra = await autoApplyFundToDebts(a);
    expect(ra.appliedCount).toBe(1);

    // B untouched until B's call
    const bDebt = await testDb.query.sessionDebts.findFirst({
      where: eq(sessionDebts.memberId, b),
    });
    expect(bDebt?.memberConfirmed).toBe(false);
  });
});

describe("claimFundContribution (integration)", () => {
  beforeEach(async () => {
    await reset();
    userMock.getUserFromCookie.mockReset();
  });

  it("creates a pending payment_notification with manual sender", async () => {
    const m = await seedMember();
    await joinFund(m);
    actAs(m);

    const r = await claimFundContribution(250_000);
    expect(r).toEqual({ success: true });

    const rows = await testDb.query.paymentNotifications.findMany({});
    expect(rows).toHaveLength(1);
    expect(rows[0].senderBank).toBe("manual");
    expect(rows[0].amount).toBe(250_000);
    expect(rows[0].status).toBe("pending");
    expect(rows[0].transferContent).toBe(`FWBB QUY ${m}`);
    expect(rows[0].gmailMessageId).toMatch(/^manual-fund-\d+-\d+$/);
  });

  it("rejects member who is not in fund", async () => {
    const m = await seedMember();
    actAs(m);
    const r = await claimFundContribution(100_000);
    expect("error" in r).toBe(true);
  });

  it.each([
    { name: "below 1k", amount: 500 },
    { name: "zero", amount: 0 },
    { name: "negative", amount: -1 },
    { name: "float", amount: 1.5 },
    { name: "above 100M", amount: 100_000_001 },
  ])("rejects invalid amount: $name", async ({ amount }) => {
    const m = await seedMember();
    await joinFund(m);
    actAs(m);
    const r = await claimFundContribution(amount);
    expect("error" in r).toBe(true);

    const rows = await testDb.query.paymentNotifications.findMany({});
    expect(rows).toHaveLength(0);
  });

  it("creates unique gmail_message_id per claim (no UNIQUE conflict)", async () => {
    const m = await seedMember();
    await joinFund(m);
    actAs(m);

    const r1 = await claimFundContribution(100_000);
    // Tiny delay to ensure different timestamp; also tests unique-by-ts
    await new Promise((r) => setTimeout(r, 5));
    const r2 = await claimFundContribution(200_000);
    expect(r1).toEqual({ success: true });
    expect(r2).toEqual({ success: true });

    const rows = await testDb.query.paymentNotifications.findMany({});
    expect(rows).toHaveLength(2);
    const ids = new Set(rows.map((r) => r.gmailMessageId));
    expect(ids.size).toBe(2);
  });

  // Avoid an unused-import warning for `paymentNotifications`/`and`
  it("imports schema tables", () => {
    expect(paymentNotifications).toBeDefined();
    expect(and).toBeDefined();
  });
});

describe("claimFundContribution (idempotency)", () => {
  beforeEach(async () => {
    await reset();
    userMock.getUserFromCookie.mockReset();
  });

  it("same idempotencyKey on retry returns replayed=true and inserts only once", async () => {
    const m = await seedMember();
    await joinFund(m);
    actAs(m);

    const key = "uuid-claim-1";
    const r1 = await claimFundContribution(200_000, key);
    const r2 = await claimFundContribution(200_000, key);

    expect(r1).toEqual({ success: true });
    expect(r2).toEqual({ success: true, replayed: true });

    const rows = await testDb.query.paymentNotifications.findMany({});
    expect(rows).toHaveLength(1);
    // The message id incorporates the idempotency key for traceability.
    expect(rows[0].gmailMessageId).toBe(`manual-fund-${m}-${key}`);
  });

  it("different idempotencyKeys produce 2 separate claims", async () => {
    const m = await seedMember();
    await joinFund(m);
    actAs(m);

    await claimFundContribution(100_000, "uuid-A");
    await claimFundContribution(100_000, "uuid-B");

    const rows = await testDb.query.paymentNotifications.findMany({});
    expect(rows).toHaveLength(2);
  });

  it("no idempotencyKey provided still works (legacy timestamp fallback)", async () => {
    const m = await seedMember();
    await joinFund(m);
    actAs(m);

    const r = await claimFundContribution(50_000);
    expect("error" in r).toBe(false);

    const rows = await testDb.query.paymentNotifications.findMany({});
    expect(rows).toHaveLength(1);
    expect(rows[0].gmailMessageId).toMatch(/^manual-fund-\d+-\d+$/);
  });
});

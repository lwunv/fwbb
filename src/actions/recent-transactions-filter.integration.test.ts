/**
 * Integration test for getRecentFinancialTransactions's excludeAuditOnly opt.
 *
 * Verifies the activity-feed fix: audit-only ledger rows (debt_*,
 * bank_payment_received) are paired with money-moving rows of the same event.
 * Showing BOTH in the user-facing feed produces "2 rows for 1 event"
 * confusion (UX bug reported via screenshot of /admin/dashboard).
 *
 * - excludeAuditOnly:true  → hide audit rows
 * - excludeAuditOnly:false (default) → return full log (admin audit trail)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { admins, members, financialTransactions } from "@/db/schema";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
  getAdminFromCookie: vi.fn(async () => ({ sub: "1", role: "admin" })),
}));
vi.mock("@/lib/user-identity", () => ({
  getUserFromCookie: vi.fn(async () => null),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { getRecentFinancialTransactions } = await import("./fund");

async function reset() {
  await client.execute("DELETE FROM financial_transactions");
  await client.execute("DELETE FROM admins");
  await client.execute("DELETE FROM members");
}

async function seedSetup() {
  const [m] = await testDb
    .insert(members)
    .values({ name: "Bắc", facebookId: `fb-bac-${Date.now()}` })
    .returning({ id: members.id });

  await testDb
    .insert(admins)
    .values({ username: "a", passwordHash: "hash", memberId: m.id });

  // Simulate a finalize: 1 debt_created (audit) + 1 fund_deduction (money).
  await testDb.insert(financialTransactions).values([
    {
      memberId: m.id,
      type: "debt_created",
      direction: "neutral",
      amount: 46_000,
      description: "Phát sinh công nợ buổi 2026-05-11",
      idempotencyKey: `debt-create-${m.id}`,
    },
    {
      memberId: m.id,
      type: "fund_deduction",
      direction: "out",
      amount: 46_000,
      description: "Trừ quỹ buổi 2026-05-11",
      idempotencyKey: `deduction-${m.id}`,
    },
  ]);

  // Simulate a bank payment: 1 bank_payment_received (audit) + 1 fund_contribution.
  await testDb.insert(financialTransactions).values([
    {
      memberId: m.id,
      type: "bank_payment_received",
      direction: "in",
      amount: 50_000,
      description: "Nhận từ TK ngân hàng",
      idempotencyKey: `bank-${m.id}`,
    },
    {
      memberId: m.id,
      type: "fund_contribution",
      direction: "in",
      amount: 50_000,
      description: "Tự động cộng quỹ từ chuyển khoản",
      idempotencyKey: `bank-contrib-${m.id}`,
    },
  ]);

  return m.id;
}

describe("getRecentFinancialTransactions excludeAuditOnly", () => {
  beforeEach(async () => await reset());

  it("default (excludeAuditOnly omitted) returns ALL rows including audit", async () => {
    await seedSetup();
    const rows = await getRecentFinancialTransactions(100);
    const types = rows.map((r) => r.type).sort();
    expect(types).toEqual([
      "bank_payment_received",
      "debt_created",
      "fund_contribution",
      "fund_deduction",
    ]);
  });

  it("excludeAuditOnly=false explicit returns ALL rows", async () => {
    await seedSetup();
    const rows = await getRecentFinancialTransactions(100, {
      excludeAuditOnly: false,
    });
    expect(rows).toHaveLength(4);
  });

  it("excludeAuditOnly=true hides debt_created + bank_payment_received", async () => {
    await seedSetup();
    const rows = await getRecentFinancialTransactions(100, {
      excludeAuditOnly: true,
    });
    const types = rows.map((r) => r.type).sort();
    expect(types).toEqual(["fund_contribution", "fund_deduction"]);
    // No audit row present
    expect(rows.some((r) => r.type === "debt_created")).toBe(false);
    expect(rows.some((r) => r.type === "bank_payment_received")).toBe(false);
  });

  it("excludeAuditOnly=true hides ALL debt_* variants (member_confirmed, admin_confirmed, undo)", async () => {
    const [m] = await testDb
      .insert(members)
      .values({ name: "T", facebookId: `fb-t-${Date.now()}` })
      .returning({ id: members.id });
    await testDb
      .insert(admins)
      .values({ username: "a2", passwordHash: "h", memberId: m.id });
    await testDb.insert(financialTransactions).values([
      {
        memberId: m.id,
        type: "fund_deduction",
        direction: "out",
        amount: 30_000,
        idempotencyKey: `d-${m.id}`,
      },
      {
        memberId: m.id,
        type: "debt_member_confirmed",
        direction: "neutral",
        amount: 30_000,
        idempotencyKey: `dmc-${m.id}`,
      },
      {
        memberId: m.id,
        type: "debt_admin_confirmed",
        direction: "neutral",
        amount: 30_000,
        idempotencyKey: `dac-${m.id}`,
      },
      {
        memberId: m.id,
        type: "debt_undo",
        direction: "neutral",
        amount: 30_000,
        idempotencyKey: `du-${m.id}`,
      },
    ]);

    const rows = await getRecentFinancialTransactions(100, {
      excludeAuditOnly: true,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("fund_deduction");
  });

  it("excludeAuditOnly=true preserves money-moving types: inventory_purchase, court_rent_payment, manual_adjustment, fund_*", async () => {
    const [m] = await testDb
      .insert(members)
      .values({ name: "X", facebookId: `fb-x-${Date.now()}` })
      .returning({ id: members.id });
    await testDb
      .insert(admins)
      .values({ username: "a3", passwordHash: "h", memberId: m.id });
    await testDb.insert(financialTransactions).values([
      {
        memberId: m.id,
        type: "fund_contribution",
        direction: "in",
        amount: 10_000,
        idempotencyKey: `fc-${m.id}`,
      },
      {
        memberId: m.id,
        type: "fund_deduction",
        direction: "out",
        amount: 10_000,
        idempotencyKey: `fd-${m.id}`,
      },
      {
        memberId: m.id,
        type: "fund_refund",
        direction: "out",
        amount: 10_000,
        idempotencyKey: `fr-${m.id}`,
      },
      {
        memberId: null,
        type: "inventory_purchase",
        direction: "out",
        amount: 100_000,
        idempotencyKey: `ip-${Date.now()}`,
      },
      {
        memberId: null,
        type: "court_rent_payment",
        direction: "out",
        amount: 2_400_000,
        idempotencyKey: `crp-${Date.now()}`,
      },
      {
        memberId: m.id,
        type: "manual_adjustment",
        direction: "in",
        amount: 5_000,
        idempotencyKey: `ma-${m.id}`,
      },
    ]);

    const rows = await getRecentFinancialTransactions(100, {
      excludeAuditOnly: true,
    });
    expect(rows).toHaveLength(6);
    const types = rows.map((r) => r.type).sort();
    expect(types).toEqual([
      "court_rent_payment",
      "fund_contribution",
      "fund_deduction",
      "fund_refund",
      "inventory_purchase",
      "manual_adjustment",
    ]);
  });
});

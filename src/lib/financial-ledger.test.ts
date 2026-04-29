/**
 * Unit tests cho `recordFinancialTransaction` — đảm bảo:
 *  - Reject số tiền âm hoặc float (financial accuracy)
 *  - Cho phép amount=0 (e.g. metadata-only audit entries)
 *  - Insert đúng fields
 *  - metadata được serialize JSON
 *  - Hoạt động bên trong db.transaction (Drizzle tx)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { financialTransactions, members } from "@/db/schema";
import { eq } from "drizzle-orm";

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { recordFinancialTransaction } = await import("./financial-ledger");

async function reset() {
  await client.execute("DELETE FROM financial_transactions");
  await client.execute("DELETE FROM members");
}

describe("recordFinancialTransaction (validation + insert)", () => {
  beforeEach(async () => {
    await reset();
  });

  it("inserts a basic fund_contribution row", async () => {
    const [m] = await testDb
      .insert(members)
      .values({ name: "A", facebookId: "fb-1" })
      .returning({ id: members.id });

    const r = await recordFinancialTransaction({
      type: "fund_contribution",
      direction: "in",
      amount: 500_000,
      memberId: m.id,
      description: "Contribution test",
      metadata: { source: "test", count: 1, valid: true, optional: null },
    });
    expect("error" in r).toBe(false);
    if ("error" in r) return; // type narrow

    expect(typeof r.id).toBe("number");

    const row = await testDb.query.financialTransactions.findFirst({
      where: eq(financialTransactions.id, r.id),
    });
    expect(row?.amount).toBe(500_000);
    expect(row?.direction).toBe("in");
    expect(row?.memberId).toBe(m.id);
    const meta = JSON.parse(row!.metadataJson!);
    expect(meta).toEqual({
      source: "test",
      count: 1,
      valid: true,
      optional: null,
    });
  });

  it("rejects negative amount", async () => {
    const r = await recordFinancialTransaction({
      type: "fund_deduction",
      direction: "out",
      amount: -1,
    });
    expect("error" in r).toBe(true);
    const all = await testDb.query.financialTransactions.findMany({});
    expect(all).toHaveLength(0);
  });

  it("rejects non-integer (float) amount", async () => {
    const r = await recordFinancialTransaction({
      type: "fund_deduction",
      direction: "out",
      amount: 100.5,
    });
    expect("error" in r).toBe(true);
  });

  it("accepts amount=0 (audit-trail with no money movement)", async () => {
    const r = await recordFinancialTransaction({
      type: "manual_adjustment",
      direction: "neutral",
      amount: 0,
      description: "Audit entry",
    });
    expect("error" in r).toBe(false);
  });

  it("stores null metadataJson when no metadata provided", async () => {
    const r = await recordFinancialTransaction({
      type: "fund_contribution",
      direction: "in",
      amount: 1_000,
    });
    if ("error" in r) throw new Error(r.error);
    const row = await testDb.query.financialTransactions.findFirst({
      where: eq(financialTransactions.id, r.id),
    });
    expect(row?.metadataJson).toBeNull();
  });

  it("works inside a db.transaction and rolls back on error", async () => {
    let insertedId: number | undefined;
    let threw = false;
    try {
      await testDb.transaction(async (tx) => {
        const r = await recordFinancialTransaction(
          {
            type: "fund_contribution",
            direction: "in",
            amount: 100_000,
            description: "tx-ok",
          },
          tx,
        );
        if ("error" in r) throw new Error(r.error);
        insertedId = r.id;

        // Force the transaction to abort
        throw new Error("forced rollback");
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    // Row should NOT exist after rollback
    const all = await testDb.query.financialTransactions.findMany({});
    expect(all).toHaveLength(0);
    expect(insertedId).toBeDefined(); // we did get an id back, but rollback dropped it
  });

  it.each([
    "fund_contribution",
    "fund_deduction",
    "fund_refund",
    "debt_created",
    "debt_member_confirmed",
    "debt_admin_confirmed",
    "debt_undo",
    "inventory_purchase",
    "manual_adjustment",
    "bank_payment_received",
  ] as const)("accepts type %s", async (type) => {
    const r = await recordFinancialTransaction({
      type,
      direction: "in",
      amount: 1_000,
    });
    expect("error" in r).toBe(false);
  });
});

describe("recordFinancialTransaction (idempotency)", () => {
  beforeEach(async () => {
    await reset();
  });

  it("inserts a row when idempotencyKey is provided for the first time", async () => {
    const [m] = await testDb
      .insert(members)
      .values({ name: "A", facebookId: "fb-1" })
      .returning({ id: members.id });

    const r = await recordFinancialTransaction({
      type: "fund_contribution",
      direction: "in",
      amount: 100_000,
      memberId: m.id,
      idempotencyKey: "uuid-first",
    });
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.replayed).toBeFalsy();

    const all = await testDb.query.financialTransactions.findMany({});
    expect(all).toHaveLength(1);
    expect(all[0].idempotencyKey).toBe("uuid-first");
  });

  it("returns the original id without inserting again on replay", async () => {
    const [m] = await testDb
      .insert(members)
      .values({ name: "A", facebookId: "fb-1" })
      .returning({ id: members.id });

    const a = await recordFinancialTransaction({
      type: "fund_contribution",
      direction: "in",
      amount: 100_000,
      memberId: m.id,
      idempotencyKey: "same-key",
    });
    if ("error" in a) throw new Error(a.error);

    const b = await recordFinancialTransaction({
      type: "fund_contribution",
      direction: "in",
      amount: 100_000,
      memberId: m.id,
      idempotencyKey: "same-key",
    });
    if ("error" in b) throw new Error(b.error);

    expect(b.id).toBe(a.id);
    expect(b.replayed).toBe(true);

    const all = await testDb.query.financialTransactions.findMany({});
    expect(all).toHaveLength(1);
  });

  it("treats null idempotencyKey as 'no key' — never coalesces null with null", async () => {
    const [m] = await testDb
      .insert(members)
      .values({ name: "A", facebookId: "fb-1" })
      .returning({ id: members.id });

    const a = await recordFinancialTransaction({
      type: "fund_contribution",
      direction: "in",
      amount: 100_000,
      memberId: m.id,
    });
    const b = await recordFinancialTransaction({
      type: "fund_contribution",
      direction: "in",
      amount: 100_000,
      memberId: m.id,
    });
    if ("error" in a || "error" in b) throw new Error("unexpected error");
    expect(b.id).not.toBe(a.id);

    const all = await testDb.query.financialTransactions.findMany({});
    expect(all).toHaveLength(2);
  });

  it("DB UNIQUE INDEX catches concurrent insert with the same key", async () => {
    const [m] = await testDb
      .insert(members)
      .values({ name: "A", facebookId: "fb-1" })
      .returning({ id: members.id });

    // Simulate the race: insert directly bypassing the helper, then call helper
    // with the same key — the helper's catch path must reload the winner.
    const winner = (
      await testDb
        .insert(financialTransactions)
        .values({
          type: "fund_contribution",
          direction: "in",
          amount: 100_000,
          memberId: m.id,
          idempotencyKey: "race-key",
        })
        .returning({ id: financialTransactions.id })
    )[0];

    const r = await recordFinancialTransaction({
      type: "fund_contribution",
      direction: "in",
      amount: 100_000,
      memberId: m.id,
      idempotencyKey: "race-key",
    });
    if ("error" in r) throw new Error(r.error);

    expect(r.id).toBe(winner.id);
    expect(r.replayed).toBe(true);

    const all = await testDb.query.financialTransactions.findMany({});
    expect(all).toHaveLength(1);
  });

  it("different idempotency keys produce different rows", async () => {
    const a = await recordFinancialTransaction({
      type: "fund_contribution",
      direction: "in",
      amount: 100_000,
      idempotencyKey: "key-A",
    });
    const b = await recordFinancialTransaction({
      type: "fund_contribution",
      direction: "in",
      amount: 100_000,
      idempotencyKey: "key-B",
    });
    if ("error" in a || "error" in b) throw new Error("unexpected error");
    expect(b.id).not.toBe(a.id);

    const all = await testDb.query.financialTransactions.findMany({});
    expect(all).toHaveLength(2);
  });
});

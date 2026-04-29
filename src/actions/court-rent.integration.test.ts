/**
 * Integration tests cho `court-rent` actions:
 *  - getCourtRentReport (year aggregate, month split)
 *  - getCourtRentPayments (filter theo metadata.targetMonth)
 *  - recordCourtRentPayment (validation + insert)
 *  - deleteCourtRentPayment
 *  - getCourtRentYears (distinct years từ sessions)
 *
 * Test trên in-memory libsql với schema thực qua `createTestDb`.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { sessions, courts, financialTransactions } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const {
  getCourtRentReport,
  getCourtRentPayments,
  recordCourtRentPayment,
  deleteCourtRentPayment,
  getCourtRentYears,
} = await import("./court-rent");

import { requireAdmin } from "@/lib/auth";

async function reset() {
  await client.execute("DELETE FROM financial_transactions");
  await client.execute("DELETE FROM session_debts");
  await client.execute("DELETE FROM session_attendees");
  await client.execute("DELETE FROM session_shuttlecocks");
  await client.execute("DELETE FROM votes");
  await client.execute("DELETE FROM sessions");
  await client.execute("DELETE FROM courts");
}

async function seedCourt(name = "Sân Hùng Vương", price = 200_000) {
  const [court] = await testDb
    .insert(courts)
    .values({
      name,
      pricePerSession: price,
      pricePerSessionRetail: price + 20_000,
    })
    .returning({ id: courts.id });
  return court.id;
}

describe("court-rent actions (integration)", () => {
  beforeEach(async () => {
    await reset();
    vi.mocked(requireAdmin).mockResolvedValue({
      admin: { sub: "1", role: "admin" },
    } as never);
  });

  // ─── getCourtRentReport ───

  describe("getCourtRentReport", () => {
    it("aggregates expected/paid/remaining by month for a year", async () => {
      const courtId = await seedCourt();

      // April: 2 active sessions (200k + 400k), 1 cancelled with passRevenue=150k
      await testDb.insert(sessions).values([
        {
          date: "2026-04-06",
          status: "completed",
          courtId,
          courtPrice: 200_000,
          courtQuantity: 1,
        },
        {
          date: "2026-04-13",
          status: "confirmed",
          courtId,
          courtPrice: 400_000,
          courtQuantity: 2,
        },
        {
          date: "2026-04-20",
          status: "cancelled",
          courtId,
          courtPrice: 200_000,
          passRevenue: 150_000,
        },
      ]);

      // March: 1 active 200k
      await testDb.insert(sessions).values({
        date: "2026-03-09",
        status: "completed",
        courtId,
        courtPrice: 200_000,
      });

      // Payment for April: 500k
      await testDb.insert(financialTransactions).values({
        type: "court_rent_payment",
        direction: "out",
        amount: 500_000,
        metadataJson: JSON.stringify({ targetMonth: "2026-04", courtId }),
      });
      // Payment for March: 200k full
      await testDb.insert(financialTransactions).values({
        type: "court_rent_payment",
        direction: "out",
        amount: 200_000,
        metadataJson: JSON.stringify({ targetMonth: "2026-03", courtId }),
      });

      const report = await getCourtRentReport(2026);
      expect(report.year).toBe(2026);
      expect(report.months).toHaveLength(12);

      const april = report.months.find((m) => m.month === 4)!;
      expect(april.sessionCount).toBe(3);
      expect(april.extraCourtSessions).toBe(1);
      expect(april.expectedTotal).toBe(600_000); // 200 + 400 (cancelled excluded)
      expect(april.passRevenue).toBe(150_000);
      expect(april.paidTotal).toBe(500_000);
      expect(april.remaining).toBe(100_000);

      const march = report.months.find((m) => m.month === 3)!;
      expect(march.expectedTotal).toBe(200_000);
      expect(march.paidTotal).toBe(200_000);
      expect(march.remaining).toBe(0);

      // Tháng không có session vẫn empty
      const may = report.months.find((m) => m.month === 5)!;
      expect(may.sessionCount).toBe(0);
      expect(may.expectedTotal).toBe(0);
      expect(may.remaining).toBe(0);

      // yearTotal
      expect(report.yearTotal.expected).toBe(800_000);
      expect(report.yearTotal.paid).toBe(700_000);
      expect(report.yearTotal.passRevenue).toBe(150_000);
      expect(report.yearTotal.remaining).toBe(100_000);
    });

    it("ignores payments from other years and malformed metadata", async () => {
      const courtId = await seedCourt();
      await testDb.insert(sessions).values({
        date: "2026-01-05",
        status: "completed",
        courtId,
        courtPrice: 100_000,
      });

      await testDb.insert(financialTransactions).values([
        {
          type: "court_rent_payment",
          direction: "out",
          amount: 50_000,
          metadataJson: JSON.stringify({ targetMonth: "2025-12" }), // wrong year
        },
        {
          type: "court_rent_payment",
          direction: "out",
          amount: 70_000,
          metadataJson: "{not-json", // invalid JSON
        },
        {
          type: "court_rent_payment",
          direction: "out",
          amount: 80_000,
          metadataJson: JSON.stringify({ targetMonth: 12 }), // wrong type
        },
        {
          type: "court_rent_payment",
          direction: "out",
          amount: 60_000,
          metadataJson: null, // missing meta
        },
      ]);

      const report = await getCourtRentReport(2026);
      expect(report.yearTotal.paid).toBe(0);
      expect(report.yearTotal.expected).toBe(100_000);
      expect(report.yearTotal.remaining).toBe(100_000);
    });

    it("returns empty structure when admin auth fails", async () => {
      vi.mocked(requireAdmin).mockResolvedValueOnce({
        error: "no auth",
      } as never);
      const r = await getCourtRentReport(2026);
      expect(r.months).toEqual([]);
      expect(r.yearTotal).toEqual({
        expected: 0,
        paid: 0,
        passRevenue: 0,
        remaining: 0,
      });
    });

    it("clamps negative remaining to zero (overpayment)", async () => {
      const courtId = await seedCourt();
      await testDb.insert(sessions).values({
        date: "2026-02-01",
        status: "completed",
        courtId,
        courtPrice: 200_000,
      });
      await testDb.insert(financialTransactions).values({
        type: "court_rent_payment",
        direction: "out",
        amount: 500_000, // overpaid
        metadataJson: JSON.stringify({ targetMonth: "2026-02" }),
      });
      const r = await getCourtRentReport(2026);
      const feb = r.months.find((m) => m.month === 2)!;
      expect(feb.remaining).toBe(0);
      expect(r.yearTotal.remaining).toBe(0);
    });
  });

  // ─── getCourtRentPayments ───

  describe("getCourtRentPayments", () => {
    it("filters by targetMonth + attaches court name", async () => {
      const courtId = await seedCourt("Sân A");
      const otherCourt = await seedCourt("Sân B", 250_000);

      await testDb.insert(financialTransactions).values([
        {
          type: "court_rent_payment",
          direction: "out",
          amount: 200_000,
          description: "Tiền sân T4",
          metadataJson: JSON.stringify({ targetMonth: "2026-04", courtId }),
        },
        {
          type: "court_rent_payment",
          direction: "out",
          amount: 250_000,
          description: "Tiền sân khác T4",
          metadataJson: JSON.stringify({
            targetMonth: "2026-04",
            courtId: otherCourt,
          }),
        },
        {
          type: "court_rent_payment",
          direction: "out",
          amount: 100_000,
          metadataJson: JSON.stringify({ targetMonth: "2026-03", courtId }),
        },
      ]);

      const apr = await getCourtRentPayments(2026, 4);
      expect(apr).toHaveLength(2);
      const named = apr.find((p) => p.courtId === courtId)!;
      expect(named.courtName).toBe("Sân A");
      expect(named.amount).toBe(200_000);

      const mar = await getCourtRentPayments(2026, 3);
      expect(mar).toHaveLength(1);
      expect(mar[0].amount).toBe(100_000);
    });

    it("returns empty array on bad auth", async () => {
      vi.mocked(requireAdmin).mockResolvedValueOnce({
        error: "no",
      } as never);
      const r = await getCourtRentPayments(2026, 4);
      expect(r).toEqual([]);
    });
  });

  // ─── recordCourtRentPayment ───

  describe("recordCourtRentPayment", () => {
    it("inserts a payment with proper metadata", async () => {
      const courtId = await seedCourt();
      const r = await recordCourtRentPayment({
        year: 2026,
        month: 5,
        amount: 600_000,
        courtId,
        note: "Trả T5 2 sân",
      });
      expect(r).toEqual({ success: true });

      const rows = await testDb.query.financialTransactions.findMany({
        where: eq(financialTransactions.type, "court_rent_payment"),
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].amount).toBe(600_000);
      expect(rows[0].direction).toBe("out");
      expect(rows[0].description).toBe("Trả T5 2 sân");
      const meta = JSON.parse(rows[0].metadataJson!);
      expect(meta.targetMonth).toBe("2026-05");
      expect(meta.courtId).toBe(courtId);
    });

    it("uses default description when no note provided", async () => {
      const r = await recordCourtRentPayment({
        year: 2026,
        month: 4,
        amount: 100_000,
      });
      expect(r).toEqual({ success: true });
      const row = await testDb.query.financialTransactions.findFirst({});
      expect(row?.description).toContain("04/2026");
    });

    it.each([
      { name: "year too low", input: { year: 1999, month: 4, amount: 1 } },
      { name: "year too high", input: { year: 2200, month: 4, amount: 1 } },
      { name: "year non-int", input: { year: 2026.5, month: 4, amount: 1 } },
      { name: "month=0", input: { year: 2026, month: 0, amount: 1 } },
      { name: "month=13", input: { year: 2026, month: 13, amount: 1 } },
      { name: "amount=0", input: { year: 2026, month: 4, amount: 0 } },
      { name: "amount negative", input: { year: 2026, month: 4, amount: -1 } },
      { name: "amount float", input: { year: 2026, month: 4, amount: 1.5 } },
      {
        name: "amount > 1B",
        input: { year: 2026, month: 4, amount: 1_000_000_001 },
      },
    ])("rejects invalid input: $name", async ({ input }) => {
      const r = await recordCourtRentPayment(input);
      expect("error" in r).toBe(true);

      // No row inserted
      const all = await testDb.query.financialTransactions.findMany({});
      expect(all).toHaveLength(0);
    });

    it("rejects non-existent courtId", async () => {
      const r = await recordCourtRentPayment({
        year: 2026,
        month: 4,
        amount: 100_000,
        courtId: 9999,
      });
      expect("error" in r).toBe(true);
    });

    it("accepts payment without courtId (general rent)", async () => {
      const r = await recordCourtRentPayment({
        year: 2026,
        month: 4,
        amount: 100_000,
      });
      expect(r).toEqual({ success: true });
      const row = await testDb.query.financialTransactions.findFirst({});
      const meta = JSON.parse(row!.metadataJson!);
      expect(meta.courtId).toBeNull();
    });

    it("returns auth error when not admin", async () => {
      vi.mocked(requireAdmin).mockResolvedValueOnce({
        error: "no auth",
      } as never);
      const r = await recordCourtRentPayment({
        year: 2026,
        month: 4,
        amount: 100_000,
      });
      expect("error" in r).toBe(true);
    });
  });

  // ─── deleteCourtRentPayment ───

  describe("deleteCourtRentPayment", () => {
    it("deletes a payment row", async () => {
      const r1 = await recordCourtRentPayment({
        year: 2026,
        month: 4,
        amount: 100_000,
      });
      expect(r1).toEqual({ success: true });
      const row = await testDb.query.financialTransactions.findFirst({});
      const r2 = await deleteCourtRentPayment(row!.id);
      expect(r2).toEqual({ success: true });

      const after = await testDb.query.financialTransactions.findFirst({});
      expect(after).toBeUndefined();
    });

    it("rejects non-existent payment id", async () => {
      const r = await deleteCourtRentPayment(99999);
      expect("error" in r).toBe(true);
    });

    it("won't delete a transaction of a different type", async () => {
      // Seed a fund_contribution row
      const [tx] = await testDb
        .insert(financialTransactions)
        .values({
          type: "fund_contribution",
          direction: "in",
          amount: 100_000,
        })
        .returning({ id: financialTransactions.id });

      const r = await deleteCourtRentPayment(tx.id);
      expect("error" in r).toBe(true);

      const stillThere = await testDb.query.financialTransactions.findFirst({});
      expect(stillThere?.id).toBe(tx.id);
    });
  });

  // ─── getCourtRentYears ───

  describe("getCourtRentYears", () => {
    it("returns sorted distinct years from sessions + current year", async () => {
      const courtId = await seedCourt();
      await testDb.insert(sessions).values([
        { date: "2024-12-01", courtId, courtPrice: 100_000 },
        { date: "2025-06-15", courtId, courtPrice: 100_000 },
        { date: "2025-09-15", courtId, courtPrice: 100_000 },
        { date: "2026-04-04", courtId, courtPrice: 100_000 },
      ]);

      const years = await getCourtRentYears();
      expect(years).toEqual(
        expect.arrayContaining([2024, 2025, 2026, new Date().getFullYear()]),
      );
      // Sorted desc
      for (let i = 1; i < years.length; i++) {
        expect(years[i - 1]).toBeGreaterThan(years[i]);
      }
    });

    it("returns at least the current year when no sessions", async () => {
      const years = await getCourtRentYears();
      expect(years).toContain(new Date().getFullYear());
    });
  });
});

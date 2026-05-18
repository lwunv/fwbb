/**
 * Integration tests for reopenSession + unlockSession.
 *
 * reopenSession (HIGH gap per audit):
 *  - Only works on status=cancelled
 *  - Reverses pass-revenue fund_contribution via reversalOfId
 *  - Resets passRevenue + status=voting
 *  - Idempotent (skip reverse if already reversed)
 *  - No financial side-effect when there was no pass-revenue
 *
 * unlockSession (HIGH gap):
 *  - Only works on status=completed
 *  - Reverses ALL fund_deduction rows via unlock-reverse-{ftx.id} key
 *  - NULL debtId before deleting sessionDebts (no orphan FK refs)
 *  - Deletes sessionAttendees + sessionDebts
 *  - Resets status=voting (admin can edit then re-finalize)
 *  - Idempotent (alreadyReversed check)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  sessions,
  admins,
  members,
  sessionAttendees,
  sessionDebts,
  financialTransactions,
} from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
}));
vi.mock("@/lib/messenger", () => ({
  sendGroupMessage: vi.fn(),
  buildNewSessionMessage: vi.fn(() => ""),
  buildConfirmedMessage: vi.fn(() => ""),
  buildDebtReminderMessage: vi.fn(() => ""),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { reopenSession, unlockSession, cancelSession } =
  await import("./sessions");
import { requireAdmin } from "@/lib/auth";

async function reset() {
  await client.execute("DELETE FROM financial_transactions");
  await client.execute("DELETE FROM session_debts");
  await client.execute("DELETE FROM session_attendees");
  await client.execute("DELETE FROM sessions");
  await client.execute("DELETE FROM admins");
  await client.execute("DELETE FROM members");
}

async function seedMember(name = "M", facebookId = `fb-${Date.now()}`) {
  const [m] = await testDb
    .insert(members)
    .values({ name, facebookId })
    .returning({ id: members.id });
  return m.id;
}

async function seedAdmin(memberId: number | null = null) {
  const [a] = await testDb
    .insert(admins)
    .values({ username: `a${Date.now()}`, passwordHash: "hash", memberId })
    .returning({ id: admins.id });
  vi.mocked(requireAdmin).mockResolvedValue({
    admin: { sub: String(a.id), role: "admin" },
  } as never);
  return a.id;
}

async function seedSession(
  status: "voting" | "confirmed" | "completed" | "cancelled",
  opts: { passRevenue?: number; date?: string } = {},
) {
  const [s] = await testDb
    .insert(sessions)
    .values({
      date: opts.date ?? "2026-04-10",
      status,
      courtPrice: 200_000,
      passRevenue: opts.passRevenue ?? null,
    })
    .returning({ id: sessions.id });
  return s.id;
}

describe("reopenSession (integration)", () => {
  beforeEach(async () => await reset());

  it("rejects when session is not cancelled", async () => {
    await seedAdmin();
    const sId = await seedSession("voting");
    const r = await reopenSession(sId);
    expect("error" in r).toBe(true);
  });

  it("rejects when session does not exist", async () => {
    await seedAdmin();
    const r = await reopenSession(99999);
    expect("error" in r).toBe(true);
  });

  it("reverses pass-revenue contribution + resets status to voting", async () => {
    const memberId = await seedMember("Admin");
    await seedAdmin(memberId);
    const sId = await seedSession("confirmed");

    // First cancel with pass to seed a fund_contribution
    await cancelSession(sId, { passed: true, passRevenue: 150_000 });

    const after = await testDb.query.sessions.findFirst({
      where: eq(sessions.id, sId),
    });
    expect(after?.status).toBe("cancelled");
    expect(after?.passRevenue).toBe(150_000);

    // Now reopen
    const r = await reopenSession(sId);
    expect(r).toEqual({ success: true });

    const reopened = await testDb.query.sessions.findFirst({
      where: eq(sessions.id, sId),
    });
    expect(reopened?.status).toBe("voting");
    expect(reopened?.passRevenue).toBeNull();

    // Ledger: original fund_contribution + reversal fund_deduction
    const txs = await testDb.query.financialTransactions.findMany({
      where: eq(financialTransactions.sessionId, sId),
    });
    expect(txs).toHaveLength(2);
    const original = txs.find((t) => t.type === "fund_contribution");
    const reversal = txs.find((t) => t.type === "fund_deduction");
    expect(original).toBeTruthy();
    expect(reversal).toBeTruthy();
    expect(reversal!.reversalOfId).toBe(original!.id);
    expect(reversal!.amount).toBe(150_000);
    expect(reversal!.memberId).toBe(memberId);
  });

  it("idempotent — second reopen on already-reopened session errors (status check)", async () => {
    const memberId = await seedMember("Admin");
    await seedAdmin(memberId);
    const sId = await seedSession("confirmed");
    await cancelSession(sId, { passed: true, passRevenue: 100_000 });

    const r1 = await reopenSession(sId);
    expect(r1).toEqual({ success: true });

    const r2 = await reopenSession(sId);
    // Second call rejects because session is no longer "cancelled"
    expect("error" in r2).toBe(true);
  });

  it("no-pass cancellation — reopen does not insert reversal (no contribution to reverse)", async () => {
    const memberId = await seedMember("Admin");
    await seedAdmin(memberId);
    const sId = await seedSession("confirmed");
    await cancelSession(sId); // no pass

    const r = await reopenSession(sId);
    expect(r).toEqual({ success: true });

    const txs = await testDb.query.financialTransactions.findMany({
      where: eq(financialTransactions.sessionId, sId),
    });
    expect(txs).toHaveLength(0);
  });
});

describe("unlockSession (integration)", () => {
  beforeEach(async () => await reset());

  it("rejects when session is not completed", async () => {
    await seedAdmin();
    const sId = await seedSession("voting");
    const r = await unlockSession(sId);
    expect("error" in r).toBe(true);
  });

  it("rejects when session does not exist", async () => {
    await seedAdmin();
    const r = await unlockSession(99999);
    expect("error" in r).toBe(true);
  });

  it("reverses all fund_deduction rows + wipes attendees+debts + status=voting", async () => {
    const adminMid = await seedMember("Admin");
    const playerMid = await seedMember("Player1");
    await seedAdmin(adminMid);
    const sId = await seedSession("completed");

    // Seed: 1 attendee, 1 sessionDebt, 1 fund_deduction
    await testDb.insert(sessionAttendees).values({
      sessionId: sId,
      memberId: playerMid,
      isGuest: false,
      attendsPlay: true,
      attendsDine: false,
    });
    const [debt] = await testDb
      .insert(sessionDebts)
      .values({
        sessionId: sId,
        memberId: playerMid,
        playAmount: 50_000,
        dineAmount: 0,
        guestPlayAmount: 0,
        guestDineAmount: 0,
        totalAmount: 50_000,
        memberConfirmed: true,
        adminConfirmed: true,
      })
      .returning({ id: sessionDebts.id });
    const [deduction] = await testDb
      .insert(financialTransactions)
      .values({
        type: "fund_deduction",
        direction: "out",
        amount: 50_000,
        memberId: playerMid,
        sessionId: sId,
        debtId: debt.id,
        idempotencyKey: `seed-deduction-${sId}-${playerMid}`,
      })
      .returning({ id: financialTransactions.id });

    const r = await unlockSession(sId);
    expect(r).toEqual({ success: true });

    // Session status
    const after = await testDb.query.sessions.findFirst({
      where: eq(sessions.id, sId),
    });
    expect(after?.status).toBe("voting");

    // attendees + debts gone
    const att = await testDb.query.sessionAttendees.findMany({
      where: eq(sessionAttendees.sessionId, sId),
    });
    expect(att).toHaveLength(0);
    const debts = await testDb.query.sessionDebts.findMany({
      where: eq(sessionDebts.sessionId, sId),
    });
    expect(debts).toHaveLength(0);

    // Original deduction kept (audit) + reversal contribution inserted
    const txs = await testDb.query.financialTransactions.findMany({
      where: eq(financialTransactions.sessionId, sId),
    });
    expect(txs).toHaveLength(2);
    const reversal = txs.find((t) => t.reversalOfId === deduction.id);
    expect(reversal).toBeTruthy();
    expect(reversal!.type).toBe("fund_contribution");
    expect(reversal!.amount).toBe(50_000);
    expect(reversal!.memberId).toBe(playerMid);
    expect(reversal!.idempotencyKey).toBe(`unlock-reverse-${deduction.id}`);

    // debtId NULL'd on remaining ledger rows
    expect(reversal!.debtId).toBeNull();
  });

  it("reverses MULTIPLE fund_deductions (multi-member session)", async () => {
    const adminMid = await seedMember("Admin");
    const p1 = await seedMember("P1");
    const p2 = await seedMember("P2");
    await seedAdmin(adminMid);
    const sId = await seedSession("completed");

    // Two deductions
    await testDb.insert(financialTransactions).values([
      {
        type: "fund_deduction",
        direction: "out",
        amount: 30_000,
        memberId: p1,
        sessionId: sId,
        idempotencyKey: `seed-1-${sId}`,
      },
      {
        type: "fund_deduction",
        direction: "out",
        amount: 40_000,
        memberId: p2,
        sessionId: sId,
        idempotencyKey: `seed-2-${sId}`,
      },
    ]);

    const r = await unlockSession(sId);
    expect(r).toEqual({ success: true });

    const reversals = await testDb.query.financialTransactions.findMany({
      where: and(
        eq(financialTransactions.sessionId, sId),
        eq(financialTransactions.type, "fund_contribution"),
      ),
    });
    expect(reversals).toHaveLength(2);
    const byMember = new Map(reversals.map((r) => [r.memberId!, r]));
    expect(byMember.get(p1)?.amount).toBe(30_000);
    expect(byMember.get(p2)?.amount).toBe(40_000);
  });

  it("idempotent re-call — already-reversed rows not double-reversed", async () => {
    const adminMid = await seedMember("Admin");
    const playerMid = await seedMember("Player");
    await seedAdmin(adminMid);
    const sId = await seedSession("completed");

    const [deduction] = await testDb
      .insert(financialTransactions)
      .values({
        type: "fund_deduction",
        direction: "out",
        amount: 50_000,
        memberId: playerMid,
        sessionId: sId,
        idempotencyKey: `seed-${sId}`,
      })
      .returning({ id: financialTransactions.id });

    // First unlock
    await unlockSession(sId);

    // Manually flip status back to completed and add a NEW seed deduction → re-unlock
    await testDb
      .update(sessions)
      .set({ status: "completed" })
      .where(eq(sessions.id, sId));

    const r = await unlockSession(sId);
    expect(r).toEqual({ success: true });

    // Original deduction has exactly ONE reversal (not double-reversed)
    const reversals = await testDb.query.financialTransactions.findMany({
      where: eq(financialTransactions.reversalOfId, deduction.id),
    });
    expect(reversals).toHaveLength(1);
  });
});

/**
 * F2 — mergeMember double-deducts target when source AND target both have
 * debts in the same finalized session.
 *
 * Bug: source and target are duplicates (e.g. accidentally created twice for
 * "Liên"). Both got finalized in session 42 → 2 fund_deduction rows. The
 * old mergeMember NULLed source's debtId, deleted source's sessionDebts
 * conflict row, then bulk-updated all source ledger rows' memberId → target.
 * Result: target has 2 LIVE fund_deduction rows for session 42 → double-
 * charged.
 *
 * Fix: before bulk re-pointing, reverse source's fund_deduction rows tied to
 * the dropped debts by inserting paired fund_contribution with reversalOfId.
 * Step 4 then re-points both halves of the pair to target → net zero for the
 * dropped duplicate, only target's own deduction remains live.
 *
 * Also reverse any admin penalty fund_contribution rows tied to the dropped
 * source debts so admin isn't double-credited.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  members,
  sessions,
  sessionDebts,
  financialTransactions,
  admins as adminsTable,
  sessionMinDeductionExemptions,
  paymentNotifications,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { computeBalanceFromTransactions } from "@/lib/fund-core";

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
  getAdminFromCookie: vi.fn(async () => ({ sub: "1", role: "admin" })),
}));
import { requireAdmin } from "@/lib/auth";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/messenger", () => ({
  sendGroupMessage: vi.fn(),
  buildDebtReminderMessage: vi.fn(() => ""),
  buildNewSessionMessage: vi.fn(),
  buildConfirmedMessage: vi.fn(),
}));
vi.mock("@/lib/user-identity", () => ({
  getUserFromCookie: vi.fn(async () => null),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { finalizeSession } = await import("./finance");
const { mergeMember } = await import("./members");

async function reset() {
  await client.execute("DELETE FROM payment_notifications");
  await client.execute("DELETE FROM financial_transactions");
  await client.execute("DELETE FROM session_min_deduction_exemptions");
  await client.execute("DELETE FROM session_debts");
  await client.execute("DELETE FROM session_attendees");
  await client.execute("DELETE FROM session_shuttlecocks");
  await client.execute("DELETE FROM votes");
  await client.execute("DELETE FROM sessions");
  await client.execute("DELETE FROM admins");
  await client.execute("DELETE FROM members");
}

async function seedActors() {
  // Source + Target are duplicates of "Liên" — both get finalized in the
  // same session so we can exercise the conflict path.
  const inserted = await testDb
    .insert(members)
    .values([
      { name: "Admin", facebookId: "fb-admin" },
      { name: "Liên-source", facebookId: "fb-source" },
      { name: "Liên-target", facebookId: "fb-target" },
    ])
    .returning({ id: members.id });
  const [adminMember, source, target] = inserted;

  const [adminRow] = await testDb
    .insert(adminsTable)
    .values({ username: "Admin", passwordHash: "x", memberId: adminMember.id })
    .returning({ id: adminsTable.id });

  vi.mocked(requireAdmin).mockResolvedValue({
    admin: { sub: String(adminRow.id), role: "admin" },
  } as never);

  return {
    adminMemberId: adminMember.id,
    sourceId: source.id,
    targetId: target.id,
  };
}

async function contributeToFund(memberId: number, amount: number) {
  await testDb.insert(financialTransactions).values({
    type: "fund_contribution",
    direction: "in",
    amount,
    memberId,
  });
}

async function getBalance(memberId: number): Promise<number> {
  const txs = await testDb.query.financialTransactions.findMany({
    where: eq(financialTransactions.memberId, memberId),
  });
  return computeBalanceFromTransactions(memberId, txs).balance;
}

async function countLiveDeductions(memberId: number): Promise<number> {
  const allRows = await testDb.query.financialTransactions.findMany({
    where: eq(financialTransactions.memberId, memberId),
  });
  const voidedIds = new Set(
    allRows
      .map((r) => r.reversalOfId)
      .filter((id): id is number => id !== null),
  );
  return allRows.filter(
    (r) =>
      r.type === "fund_deduction" &&
      r.reversalOfId === null &&
      !voidedIds.has(r.id),
  ).length;
}

describe("F2 — mergeMember conflict reversal prevents double-deduct", () => {
  beforeEach(reset);

  it("does NOT double-deduct target when both duplicates have debts in same session", async () => {
    // Setup: admin + source + target. Both seeded with 100K.
    const { adminMemberId, sourceId, targetId } = await seedActors();
    // Members default isActive=true, approvalStatus='approved' → in-fund.
    await contributeToFund(sourceId, 100_000);
    await contributeToFund(targetId, 100_000);

    // Finalize a session with admin + source + target attending.
    // courtPrice 60K, 3 players → 20K each.
    const [s] = await testDb
      .insert(sessions)
      .values({ date: "2026-05-20", status: "confirmed", courtPrice: 60_000 })
      .returning({ id: sessions.id });
    const r = await finalizeSession(
      s.id,
      [
        {
          memberId: adminMemberId,
          guestName: null,
          invitedById: null,
          isGuest: false,
          attendsPlay: true,
          attendsDine: false,
        },
        {
          memberId: sourceId,
          guestName: null,
          invitedById: null,
          isGuest: false,
          attendsPlay: true,
          attendsDine: false,
        },
        {
          memberId: targetId,
          guestName: null,
          invitedById: null,
          isGuest: false,
          attendsPlay: true,
          attendsDine: false,
        },
      ],
      0,
    );
    expect("error" in r).toBe(false);

    // Both source and target have balance 80K (deducted 20K each).
    expect(await getBalance(sourceId)).toBe(80_000);
    expect(await getBalance(targetId)).toBe(80_000);

    // Merge source → target.
    const mergeR = await mergeMember(sourceId, targetId);
    expect("error" in mergeR).toBe(false);

    // Target receives source's 100K contribution + source's 20K reversal,
    // net effect after merge:
    //   target's pre-merge balance = 80K (its own contribution 100K minus deduction 20K).
    //   target gains source's contributions 100K  + source's deduction reversal +20K
    //   minus source's deduction -20K (which IS still in ledger as voided pair),
    //   = balance 80K + 100K = 180K.
    // Crucially NOT 60K (double-deduct).
    expect(await getBalance(targetId)).toBe(180_000);

    // Exactly 1 LIVE fund_deduction owned by target (the original target one).
    expect(await countLiveDeductions(targetId)).toBe(1);

    // Source row is deleted.
    const sourceMember = await testDb.query.members.findFirst({
      where: eq(members.id, sourceId),
    });
    expect(sourceMember).toBeUndefined();
  });

  it("re-points sessionMinDeductionExemptions to target (not cascade-deleted)", async () => {
    // B3: bảng exemptions có FK memberId ON DELETE CASCADE. Nếu merge không
    // re-point trước khi xóa source, exemption của source biến mất → buổi đó
    // re-finalize sẽ tính sàn 60K cho target (tưởng không được miễn) → thu oan.
    const { sourceId, targetId } = await seedActors();
    const [s] = await testDb
      .insert(sessions)
      .values({
        date: "2026-05-21",
        status: "completed",
        courtPrice: 60_000,
        useMinDeduction: true,
      })
      .returning({ id: sessions.id });
    await testDb
      .insert(sessionMinDeductionExemptions)
      .values({ sessionId: s.id, memberId: sourceId });

    const mergeR = await mergeMember(sourceId, targetId);
    expect("error" in mergeR).toBe(false);

    // Exemption vẫn còn (không bị cascade xóa) và giờ thuộc target.
    const rows = await testDb.query.sessionMinDeductionExemptions.findMany({});
    expect(rows).toHaveLength(1);
    expect(rows[0].memberId).toBe(targetId);
    expect(rows[0].sessionId).toBe(s.id);
  });

  it("refuses merge when a conflicting SOURCE debt has a matched bank payment", async () => {
    // B4: nhánh conflict luôn giữ debt target + reverse ledger source. Nếu chính
    // source mới là bên nhận chuyển khoản thật, merge sẽ huỷ tiền thật. Chặn lại.
    const { sourceId, targetId } = await seedActors();
    const [s] = await testDb
      .insert(sessions)
      .values({ date: "2026-05-22", status: "completed", courtPrice: 60_000 })
      .returning({ id: sessions.id });
    const [srcDebt] = await testDb
      .insert(sessionDebts)
      .values({ sessionId: s.id, memberId: sourceId, totalAmount: 20_000 })
      .returning({ id: sessionDebts.id });
    await testDb
      .insert(sessionDebts)
      .values({ sessionId: s.id, memberId: targetId, totalAmount: 20_000 });
    // Source's debt received a matched bank transfer (real money in admin acct).
    await testDb.insert(paymentNotifications).values({
      gmailMessageId: "g-bank-merge",
      transferContent: "FWBB NO src",
      amount: 20_000,
      matchedDebtId: srcDebt.id,
      status: "matched",
    });

    const mergeR = await mergeMember(sourceId, targetId);
    expect("error" in mergeR).toBe(true);

    // Merge bị hủy → source CHƯA bị xóa (admin xử lý tay trước).
    const src = await testDb.query.members.findFirst({
      where: eq(members.id, sourceId),
    });
    expect(src).toBeTruthy();
  });

  it("reverses admin min-deduction penalty when source duplicate had floored debt in conflict session", async () => {
    // Setup: source has balance 0 → floor fires on source.
    // target has balance 100K → no floor.
    // Both attend session with courtPrice=60K, 3 players (admin+source+target).
    // perHead = 20K. Source: floored 60K (penalty 40K to admin).
    // Target: 20K (no floor).
    // After merge: admin's penalty for source's debt must be reversed,
    // admin only keeps target's debt (no floor for target → no penalty).
    const { adminMemberId, sourceId, targetId } = await seedActors();
    // Members default in-fund. Only target funded.
    await contributeToFund(targetId, 100_000);
    // source: no contribution → balance 0 → floor fires.

    const [s] = await testDb
      .insert(sessions)
      .values({
        date: "2026-05-21",
        status: "confirmed",
        courtPrice: 60_000,
        useMinDeduction: true,
      })
      .returning({ id: sessions.id });
    const r = await finalizeSession(
      s.id,
      [
        {
          memberId: adminMemberId,
          guestName: null,
          invitedById: null,
          isGuest: false,
          attendsPlay: true,
          attendsDine: false,
        },
        {
          memberId: sourceId,
          guestName: null,
          invitedById: null,
          isGuest: false,
          attendsPlay: true,
          attendsDine: false,
        },
        {
          memberId: targetId,
          guestName: null,
          invitedById: null,
          isGuest: false,
          attendsPlay: true,
          attendsDine: false,
        },
      ],
      0,
    );
    expect("error" in r).toBe(false);

    // perHead = 20K; source floored 60K → penalty 40K to admin.
    // target's deduction = 20K (no floor, balance OK).
    // Admin (new design): own play deducted 20K. Admin = 40K - 20K = 20K.
    expect(await getBalance(adminMemberId)).toBe(20_000);
    expect(await getBalance(sourceId)).toBe(-60_000);
    expect(await getBalance(targetId)).toBe(80_000);

    const mergeR = await mergeMember(sourceId, targetId);
    expect("error" in mergeR).toBe(false);

    // After merge: source's penalty reversed (admin loses 40K).
    // Admin's own play deduction stays → -20K.
    expect(await getBalance(adminMemberId)).toBe(-20_000);

    // Target balance: started 80K (own debt). Gains source's voided
    // deduction-reversal pair (nets 0) + nothing else (source had no
    // contribution to inherit). Final 80K.
    expect(await getBalance(targetId)).toBe(80_000);

    // Single live deduction on target.
    expect(await countLiveDeductions(targetId)).toBe(1);
  });

  it("merge with no debt conflict still works (only one side has the debt)", async () => {
    // Only target attends the session — source has no debt for it.
    // Merge should just move source's ledger to target without reversal.
    const { adminMemberId, sourceId, targetId } = await seedActors();
    // Members default in-fund.
    await contributeToFund(sourceId, 50_000);
    await contributeToFund(targetId, 100_000);

    const [s] = await testDb
      .insert(sessions)
      .values({ date: "2026-05-22", status: "confirmed", courtPrice: 40_000 })
      .returning({ id: sessions.id });
    const r = await finalizeSession(
      s.id,
      [
        {
          memberId: adminMemberId,
          guestName: null,
          invitedById: null,
          isGuest: false,
          attendsPlay: true,
          attendsDine: false,
        },
        {
          memberId: targetId,
          guestName: null,
          invitedById: null,
          isGuest: false,
          attendsPlay: true,
          attendsDine: false,
        },
      ],
      0,
    );
    expect("error" in r).toBe(false);

    // target deducted 20K → 80K balance. source untouched at 50K.
    expect(await getBalance(targetId)).toBe(80_000);
    expect(await getBalance(sourceId)).toBe(50_000);

    const mergeR = await mergeMember(sourceId, targetId);
    expect("error" in mergeR).toBe(false);

    // target gains source's 50K contribution → 80K + 50K = 130K.
    expect(await getBalance(targetId)).toBe(130_000);
    expect(await countLiveDeductions(targetId)).toBe(1);
  });

  it("idempotent: re-running mergeMember after partial completion is safe", async () => {
    // We can't easily simulate a partial commit (the whole tx commits or
    // rolls back), but we can verify the reversal idempotencyKey path: if
    // a reversal row already exists for a source deduction, the second call
    // doesn't double-reverse. We seed the reversal manually and check the
    // merge path doesn't insert another.
    const { adminMemberId, sourceId, targetId } = await seedActors();
    // Members default in-fund.
    await contributeToFund(sourceId, 100_000);
    await contributeToFund(targetId, 100_000);

    const [s] = await testDb
      .insert(sessions)
      .values({ date: "2026-05-23", status: "confirmed", courtPrice: 60_000 })
      .returning({ id: sessions.id });
    const r = await finalizeSession(
      s.id,
      [
        {
          memberId: adminMemberId,
          guestName: null,
          invitedById: null,
          isGuest: false,
          attendsPlay: true,
          attendsDine: false,
        },
        {
          memberId: sourceId,
          guestName: null,
          invitedById: null,
          isGuest: false,
          attendsPlay: true,
          attendsDine: false,
        },
        {
          memberId: targetId,
          guestName: null,
          invitedById: null,
          isGuest: false,
          attendsPlay: true,
          attendsDine: false,
        },
      ],
      0,
    );
    expect("error" in r).toBe(false);

    // Pre-insert a reversal for source's deduction with the same
    // idempotencyKey the merge would use.
    const sourceDeduction = await testDb.query.financialTransactions.findFirst({
      where: and(
        eq(financialTransactions.memberId, sourceId),
        eq(financialTransactions.type, "fund_deduction"),
      ),
    });
    expect(sourceDeduction).toBeDefined();
    // Inserting a manual reversal with same idempotency key as the merge
    // path would generate.
    await testDb.insert(financialTransactions).values({
      type: "fund_contribution",
      direction: "in",
      amount: sourceDeduction!.amount,
      memberId: sourceId,
      sessionId: sourceDeduction!.sessionId,
      reversalOfId: sourceDeduction!.id,
      idempotencyKey: `merge-reverse-deduction-${sourceDeduction!.id}`,
      description: "manual pre-existing reversal",
    });

    const mergeR = await mergeMember(sourceId, targetId);
    expect("error" in mergeR).toBe(false);

    // Only ONE reversal exists for the source deduction (the pre-inserted one).
    const reversals = await testDb.query.financialTransactions.findMany({
      where: eq(financialTransactions.reversalOfId, sourceDeduction!.id),
    });
    expect(reversals).toHaveLength(1);

    // Target has exactly 1 live deduction (its own).
    expect(await countLiveDeductions(targetId)).toBe(1);
  });
});

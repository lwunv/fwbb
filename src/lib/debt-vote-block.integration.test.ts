/**
 * Chặn vote khi nợ quá hạn mức: tự bỏ phiếu ở buổi còn mở vote.
 * Spec: docs/superpowers/specs/2026-11-06-debt-vote-block-design.md mục 4.3.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members, sessions, votes, financialTransactions } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { enforceDebtVoteBlock } = await import("./debt-vote-block");

const LIMIT = 100_000;

async function reset() {
  await client.execute("DELETE FROM financial_transactions");
  await client.execute("DELETE FROM votes");
  await client.execute("DELETE FROM sessions");
  await client.execute("DELETE FROM members");
}

/** "YYYY-MM-DDTHH:MM" giờ VN, lệch `days` ngày so với bây giờ. */
function deadline(days: number): string {
  const d = new Date(Date.now() + 7 * 3600_000 + days * 86400_000);
  return d.toISOString().slice(0, 16);
}

async function seedMember(name: string, balance: number) {
  const [m] = await testDb
    .insert(members)
    .values({ name, facebookId: `fb-${name}` })
    .returning({ id: members.id });
  if (balance !== 0) {
    await testDb.insert(financialTransactions).values({
      type: balance > 0 ? "fund_contribution" : "fund_deduction",
      direction: balance > 0 ? "in" : "out",
      amount: Math.abs(balance),
      memberId: m.id,
    });
  }
  return m.id;
}

let dayCounter = 1;
async function seedSession(
  status: "voting" | "confirmed" | "completed" | "cancelled",
  deadlineDays: number,
) {
  const date = `2026-12-${String(dayCounter++).padStart(2, "0")}`;
  const [s] = await testDb
    .insert(sessions)
    .values({ date, status, voteDeadline: deadline(deadlineDays) })
    .returning({ id: sessions.id });
  return s.id;
}

async function vote(sessionId: number, memberId: number) {
  await testDb
    .insert(votes)
    .values({ sessionId, memberId, willPlay: true, willDine: false });
}

async function voteSessionIds(memberId: number) {
  const rows = await testDb
    .select({ sessionId: votes.sessionId })
    .from(votes)
    .where(eq(votes.memberId, memberId));
  return rows.map((r) => r.sessionId).sort((a, b) => a - b);
}

describe("enforceDebtVoteBlock", () => {
  let A: number, B: number, C: number, D: number;

  beforeEach(async () => {
    await reset();
    dayCounter = 1;
    A = await seedSession("voting", 1);
    B = await seedSession("confirmed", 1);
    C = await seedSession("voting", -1);
    D = await seedSession("completed", 1);
  });

  async function seedDebtorWithFourVotes(balance: number) {
    const id = await seedMember("Thanh", balance);
    for (const s of [A, B, C, D]) await vote(s, id);
    return id;
  }

  it("xoá phiếu ở buổi còn mở vote (voting/confirmed chưa quá hạn)", async () => {
    const id = await seedDebtorWithFourVotes(-188_000);
    const r = await enforceDebtVoteBlock(testDb, [id], LIMIT);
    expect(r.removed).toEqual(
      expect.arrayContaining([
        { memberId: id, sessionId: A },
        { memberId: id, sessionId: B },
      ]),
    );
    expect(r.removed).toHaveLength(2);
    expect(await voteSessionIds(id)).toEqual([C, D].sort((a, b) => a - b));
  });

  it("giữ phiếu ở buổi quá hạn vote hoặc đã chốt", async () => {
    const id = await seedDebtorWithFourVotes(-188_000);
    await enforceDebtVoteBlock(testDb, [id], LIMIT);
    const left = await voteSessionIds(id);
    expect(left).toContain(C);
    expect(left).toContain(D);
  });

  it("member chưa tới hạn mức (-99.999) → không xoá gì", async () => {
    const id = await seedDebtorWithFourVotes(-99_999);
    const r = await enforceDebtVoteBlock(testDb, [id], LIMIT);
    expect(r.removed).toEqual([]);
    expect(await voteSessionIds(id)).toHaveLength(4);
  });

  it("phiếu của member khác không bị đụng", async () => {
    const debtor = await seedDebtorWithFourVotes(-188_000);
    const other = await seedMember("Lan", 50_000);
    await vote(A, other);
    await enforceDebtVoteBlock(testDb, [debtor], LIMIT);
    expect(await voteSessionIds(other)).toEqual([A]);
  });

  it("danh sách rỗng → không lỗi, không xoá", async () => {
    const r = await enforceDebtVoteBlock(testDb, [], LIMIT);
    expect(r.removed).toEqual([]);
  });
});

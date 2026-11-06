/**
 * submitVote chặn member nợ quá hạn mức (spec 2026-11-06-debt-vote-block-design.md
 * mục 4.2). Hạn mức = mặc định setting `voteBlockDebtThreshold` (100.000) vì
 * bảng app_settings rỗng.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members, sessions, votes, financialTransactions } from "@/db/schema";
import { and, eq } from "drizzle-orm";

const userMock = vi.hoisted(() => ({
  getUserFromCookie:
    vi.fn<() => Promise<{ memberId: number; externalId: string } | null>>(),
}));
vi.mock("@/lib/user-identity", () => userMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
  getAdminFromCookie: vi.fn(async () => ({ sub: "1", role: "admin" })),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { submitVote, adminSetVote } = await import("./votes");

async function reset() {
  for (const t of [
    "rate_limit_buckets",
    "financial_transactions",
    "votes",
    "sessions",
    "members",
    "app_settings",
  ]) {
    await client.execute(`DELETE FROM ${t}`);
  }
  userMock.getUserFromCookie.mockReset();
}

async function seedMemberWithBalance(balance: number) {
  const [m] = await testDb
    .insert(members)
    .values({ name: "Thanh", facebookId: "fb-thanh" })
    .returning({ id: members.id });
  if (balance < 0) {
    await testDb.insert(financialTransactions).values({
      type: "fund_deduction",
      direction: "out",
      amount: -balance,
      memberId: m.id,
    });
  }
  userMock.getUserFromCookie.mockResolvedValue({
    memberId: m.id,
    externalId: "fb-thanh",
  });
  return m.id;
}

async function seedSession() {
  const [s] = await testDb
    .insert(sessions)
    .values({ date: "2026-12-01", status: "voting", voteDeadline: null })
    .returning({ id: sessions.id });
  return s.id;
}

async function voteOf(sessionId: number, memberId: number) {
  return testDb.query.votes.findFirst({
    where: and(eq(votes.sessionId, sessionId), eq(votes.memberId, memberId)),
  });
}

describe("submitVote — chặn khi nợ quá hạn mức", () => {
  beforeEach(reset);

  it("member nợ quá hạn mức vote chơi → trả error, không có dòng votes", async () => {
    const id = await seedMemberWithBalance(-188_000);
    const s = await seedSession();
    const r = await submitVote(s, true, false, 0, 0, false);
    expect("error" in r).toBe(true);
    expect(await voteOf(s, id)).toBeUndefined();
  });

  it("member nợ quá hạn mức bỏ vote (false,false) → success, dòng bị xoá", async () => {
    const id = await seedMemberWithBalance(-188_000);
    const s = await seedSession();
    await testDb
      .insert(votes)
      .values({ sessionId: s, memberId: id, willPlay: true, willDine: false });
    const r = await submitVote(s, false, false, 0, 0, false);
    expect("error" in r).toBe(false);
    expect(await voteOf(s, id)).toBeUndefined();
  });

  it("member nợ dưới hạn mức vote → success", async () => {
    const id = await seedMemberWithBalance(-99_999);
    const s = await seedSession();
    const r = await submitVote(s, true, false, 0, 0, false);
    expect("error" in r).toBe(false);
    expect((await voteOf(s, id))?.willPlay).toBe(true);
  });

  it("adminSetVote cho member nợ quá hạn mức → success", async () => {
    const id = await seedMemberWithBalance(-188_000);
    const s = await seedSession();
    const r = await adminSetVote(s, id, true, false);
    expect(r && "error" in r).toBe(false);
    expect((await voteOf(s, id))?.willPlay).toBe(true);
  });
});

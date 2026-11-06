/**
 * Admin hạ hạn mức nợ chặn vote → phiếu của member nay đã quá hạn mức ở buổi
 * còn mở vote bị bỏ ngay (spec 2026-11-06-debt-vote-block-design.md mục 4.3).
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members, sessions, votes, financialTransactions } from "@/db/schema";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { role: "admin" } })),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { updateSetting } = await import("./settings");

async function seed() {
  for (const t of [
    "financial_transactions",
    "votes",
    "sessions",
    "members",
    "app_settings",
  ]) {
    await client.execute(`DELETE FROM ${t}`);
  }
  const [m] = await testDb
    .insert(members)
    .values({ name: "Thanh", facebookId: "fb-thanh" })
    .returning({ id: members.id });
  await testDb.insert(financialTransactions).values({
    type: "fund_deduction",
    direction: "out",
    amount: 188_000,
    memberId: m.id,
  });
  const [s] = await testDb
    .insert(sessions)
    .values({ date: "2026-12-01", status: "voting", voteDeadline: null })
    .returning({ id: sessions.id });
  await testDb
    .insert(votes)
    .values({
      sessionId: s.id,
      memberId: m.id,
      willPlay: true,
      willDine: false,
    });
  return { memberId: m.id, sessionId: s.id };
}

async function voteCount() {
  return (await testDb.select().from(votes)).length;
}

describe("updateSetting voteBlockDebtThreshold", () => {
  beforeEach(async () => {
    await client.execute("DELETE FROM app_settings");
  });

  it("admin hạ hạn mức từ 200.000 xuống 100.000 → phiếu của member nợ 188.000 ở buổi mở vote bị xoá", async () => {
    await seed();
    await updateSetting("voteBlockDebtThreshold", 200_000);
    expect(await voteCount()).toBe(1);
    const r = await updateSetting("voteBlockDebtThreshold", 100_000);
    expect(r).toEqual({ success: true });
    expect(await voteCount()).toBe(0);
  });

  it("admin nâng hạn mức → không xoá gì", async () => {
    await seed();
    await updateSetting("voteBlockDebtThreshold", 200_000);
    await updateSetting("voteBlockDebtThreshold", 300_000);
    expect(await voteCount()).toBe(1);
  });
});

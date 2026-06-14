/**
 * submitVote core: upsert (insert mới + update khi vote lại), gate theo status,
 * validate guest count, chặn member không đủ điều kiện. (Deadline gate đã cover
 * ở vote-deadline.integration.test.ts.)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members, sessions, votes } from "@/db/schema";
import { and, eq } from "drizzle-orm";

const userMock = vi.hoisted(() => ({
  getUserFromCookie:
    vi.fn<() => Promise<{ memberId: number; externalId: string } | null>>(),
}));
vi.mock("@/lib/user-identity", () => userMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { submitVote } = await import("./votes");

async function reset() {
  await client.execute("DELETE FROM rate_limit_buckets");
  await client.execute("DELETE FROM votes");
  await client.execute("DELETE FROM sessions");
  await client.execute("DELETE FROM members");
  userMock.getUserFromCookie.mockReset();
}

async function seedMember(
  opts: {
    isActive?: boolean;
    approvalStatus?: "pending" | "approved" | "rejected";
  } = {},
) {
  const [m] = await testDb
    .insert(members)
    .values({
      name: "Alice",
      facebookId: "fb-a",
      isActive: opts.isActive ?? true,
      approvalStatus: opts.approvalStatus ?? "approved",
    })
    .returning({ id: members.id });
  userMock.getUserFromCookie.mockResolvedValue({
    memberId: m.id,
    externalId: "fb-a",
  });
  return m.id;
}

async function seedSession(
  status: "voting" | "confirmed" | "completed" | "cancelled" = "voting",
) {
  const [s] = await testDb
    .insert(sessions)
    .values({ date: "2026-06-01", status, voteDeadline: null })
    .returning({ id: sessions.id });
  return s.id;
}

async function voteOf(sessionId: number, memberId: number) {
  return testDb.query.votes.findFirst({
    where: and(eq(votes.sessionId, sessionId), eq(votes.memberId, memberId)),
  });
}

describe("submitVote — upsert + validation + gate", () => {
  beforeEach(reset);

  it("ghi vote mới đúng giá trị (play/dine/guest)", async () => {
    const id = await seedMember();
    const s = await seedSession("voting");

    const r = await submitVote(s, true, true, 2, 1);
    expect("error" in r).toBe(false);

    const v = await voteOf(s, id);
    expect(v?.willPlay).toBe(true);
    expect(v?.willDine).toBe(true);
    expect(v?.guestPlayCount).toBe(2);
    expect(v?.guestDineCount).toBe(1);
  });

  it("vote lại UPDATE đúng 1 row (không nhân đôi)", async () => {
    const id = await seedMember();
    const s = await seedSession("voting");

    await submitVote(s, true, false, 0, 0);
    await submitVote(s, false, true, 3, 0);

    const rows = await testDb.query.votes.findMany({
      where: and(eq(votes.sessionId, s), eq(votes.memberId, id)),
    });
    expect(rows.length).toBe(1);
    expect(rows[0].willPlay).toBe(false);
    expect(rows[0].willDine).toBe(true);
    expect(rows[0].guestPlayCount).toBe(3);
  });

  it("chặn vote khi session đã completed", async () => {
    await seedMember();
    const s = await seedSession("completed");
    const r = await submitVote(s, true, false, 0, 0);
    expect("error" in r).toBe(true);
  });

  it("chặn vote khi session đã cancelled", async () => {
    await seedMember();
    const s = await seedSession("cancelled");
    const r = await submitVote(s, true, false, 0, 0);
    expect("error" in r).toBe(true);
  });

  it("từ chối guest count âm (zod)", async () => {
    await seedMember();
    const s = await seedSession("voting");
    const r = await submitVote(s, true, false, -1, 0);
    expect("error" in r).toBe(true);
  });

  it("chặn member đã khóa (isActive=false) vote", async () => {
    await seedMember({ isActive: false });
    const s = await seedSession("voting");
    const r = await submitVote(s, true, false, 0, 0);
    expect("error" in r).toBe(true);
  });

  it("chặn member chưa duyệt (pending) vote", async () => {
    await seedMember({ approvalStatus: "pending" });
    const s = await seedSession("voting");
    const r = await submitVote(s, true, false, 0, 0);
    expect("error" in r).toBe(true);
  });
});

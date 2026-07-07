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

  it("ghi vote mới đúng giá trị; khách member bị ép 0 (chỉ admin thêm khách)", async () => {
    const id = await seedMember();
    const s = await seedSession("voting");

    // Client có thể gửi guest count (RPC), nhưng server ép về 0.
    const r = await submitVote(s, true, true, 2, 1, false);
    expect("error" in r).toBe(false);

    const v = await voteOf(s, id);
    expect(v?.willPlay).toBe(true);
    expect(v?.willDine).toBe(true);
    expect(v?.guestPlayCount).toBe(0);
    expect(v?.guestDineCount).toBe(0);
  });

  it("vote lại UPDATE đúng 1 row (không nhân đôi); khách vẫn 0", async () => {
    const id = await seedMember();
    const s = await seedSession("voting");

    await submitVote(s, true, false, 0, 0, false);
    await submitVote(s, false, true, 3, 0, false);

    const rows = await testDb.query.votes.findMany({
      where: and(eq(votes.sessionId, s), eq(votes.memberId, id)),
    });
    expect(rows.length).toBe(1);
    expect(rows[0].willPlay).toBe(false);
    expect(rows[0].willDine).toBe(true);
    expect(rows[0].guestPlayCount).toBe(0);
  });

  it("chặn vote khi session đã completed", async () => {
    await seedMember();
    const s = await seedSession("completed");
    const r = await submitVote(s, true, false, 0, 0, false);
    expect("error" in r).toBe(true);
  });

  it("chặn vote khi session đã cancelled", async () => {
    await seedMember();
    const s = await seedSession("cancelled");
    const r = await submitVote(s, true, false, 0, 0, false);
    expect("error" in r).toBe(true);
  });

  it("từ chối guest count âm (zod)", async () => {
    await seedMember();
    const s = await seedSession("voting");
    const r = await submitVote(s, true, false, -1, 0, false);
    expect("error" in r).toBe(true);
  });

  it("chặn member đã khóa (isActive=false) vote", async () => {
    await seedMember({ isActive: false });
    const s = await seedSession("voting");
    const r = await submitVote(s, true, false, 0, 0, false);
    expect("error" in r).toBe(true);
  });

  it("chặn member chưa duyệt (pending) vote", async () => {
    await seedMember({ approvalStatus: "pending" });
    const s = await seedSession("voting");
    const r = await submitVote(s, true, false, 0, 0, false);
    expect("error" in r).toBe(true);
  });
});

/** Seed n member KHÁC + vote chơi cầu cho họ (mỗi người 1 đầu, hoặc 2 nếu partner). */
async function seedPlayers(sessionId: number, n: number, withPartner = false) {
  for (let i = 0; i < n; i++) {
    const [m] = await testDb
      .insert(members)
      .values({ name: `P${i}`, isActive: true, approvalStatus: "approved" })
      .returning({ id: members.id });
    await testDb.insert(votes).values({
      sessionId,
      memberId: m.id,
      willPlay: true,
      willDine: false,
      guestPlayCount: 0,
      guestDineCount: 0,
      withPartner,
    });
  }
}

describe("submitVote — giới hạn 16 người chơi cầu (Hết slot)", () => {
  beforeEach(reset);

  it("chặn vote chơi khi đã đủ 16 người", async () => {
    const id = await seedMember();
    const s = await seedSession("voting");
    await seedPlayers(s, 16); // 16 đầu chơi từ member khác

    const r = await submitVote(s, true, false, 0, 0, false);
    expect("error" in r).toBe(true);
    // Không tạo vote chơi cho member này.
    expect(await voteOf(s, id)).toBeUndefined();
  });

  it("member ĐANG chơi vẫn bỏ được vote khi đủ 16", async () => {
    const id = await seedMember();
    const s = await seedSession("voting");
    await seedPlayers(s, 15); // 15 khác + member này = 16
    await testDb.insert(votes).values({
      sessionId: s,
      memberId: id,
      willPlay: true,
      willDine: false,
      guestPlayCount: 0,
      guestDineCount: 0,
      withPartner: false,
    });

    const r = await submitVote(s, false, false, 0, 0, false); // bỏ chơi
    expect("error" in r).toBe(false);
    expect((await voteOf(s, id))?.willPlay).toBe(false);
  });

  it("cho vote NHẬU khi chơi đã đủ 16", async () => {
    const id = await seedMember();
    const s = await seedSession("voting");
    await seedPlayers(s, 16);

    const r = await submitVote(s, false, true, 0, 0, false); // chỉ nhậu
    expect("error" in r).toBe(false);
    expect((await voteOf(s, id))?.willDine).toBe(true);
  });

  it("chặn 'đi 2 mình' khi chỉ còn 1 slot", async () => {
    await seedMember();
    const s = await seedSession("voting");
    await seedPlayers(s, 15); // còn 1 slot

    const r = await submitVote(s, true, false, 0, 0, true); // +2 đầu → 17
    expect("error" in r).toBe(true);
  });

  it("cho 'đi 2 mình' khi còn đúng 2 slot", async () => {
    await seedMember();
    const s = await seedSession("voting");
    await seedPlayers(s, 14); // còn 2 slot

    const r = await submitVote(s, true, false, 0, 0, true); // +2 đầu → 16
    expect("error" in r).toBe(false);
  });

  it("khách của admin tính vào sức chứa 16", async () => {
    const id = await seedMember();
    const s = await seedSession("voting");
    await testDb
      .update(sessions)
      .set({ adminGuestPlayCount: 16 })
      .where(eq(sessions.id, s));

    const r = await submitVote(s, true, false, 0, 0, false);
    expect("error" in r).toBe(true);
    expect(await voteOf(s, id)).toBeUndefined();
  });

  it("vote của member đã KHÓA không chiếm slot (finalize bỏ họ) — active member vẫn vote được", async () => {
    const id = await seedMember(); // active + approved (Alice, cookie owner)
    const s = await seedSession("voting");
    await seedPlayers(s, 15); // 15 active players → + Alice = 16 real players

    // Locked member với vote willPlay còn sót. finalize (buildAttendees) bỏ qua
    // họ, nên slot này thực chất trống — capacity gate KHÔNG được đếm họ.
    const [locked] = await testDb
      .insert(members)
      .values({
        name: "Locked",
        facebookId: "fb-locked",
        isActive: false,
        approvalStatus: "approved",
      })
      .returning({ id: members.id });
    await testDb.insert(votes).values({
      sessionId: s,
      memberId: locked.id,
      willPlay: true,
      willDine: false,
      guestPlayCount: 0,
      guestDineCount: 0,
      withPartner: false,
    });

    // Alice là người chơi thật thứ 16 → phải được vote (nếu đếm cả locked thì
    // thành 17 → bị chặn oan).
    const r = await submitVote(s, true, false, 0, 0, false);
    expect("error" in r).toBe(false);
    expect((await voteOf(s, id))?.willPlay).toBe(true);
  });
});

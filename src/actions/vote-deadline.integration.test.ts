/**
 * Vote deadline behaviour: submitVote rejects after deadline,
 * setVoteDeadline + extendVoteDeadline gate properly.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members, sessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { formatLocalDeadline } from "@/lib/vote-deadline";

const userMock = vi.hoisted(() => ({
  getUserFromCookie:
    vi.fn<() => Promise<{ memberId: number; externalId: string } | null>>(),
}));
vi.mock("@/lib/user-identity", () => userMock);
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
  getAdminFromCookie: vi.fn(async () => ({ sub: "1", role: "admin" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/messenger", () => ({
  sendGroupMessage: vi.fn(),
  buildDebtReminderMessage: vi.fn(),
  buildNewSessionMessage: vi.fn(),
  buildConfirmedMessage: vi.fn(),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { submitVote } = await import("./votes");
const { setVoteDeadline, extendVoteDeadline } = await import("./sessions");

async function reset() {
  await client.execute("DELETE FROM rate_limit_buckets");
  await client.execute("DELETE FROM votes");
  await client.execute("DELETE FROM sessions");
  await client.execute("DELETE FROM members");
  userMock.getUserFromCookie.mockReset();
}

async function seedMember() {
  const [m] = await testDb
    .insert(members)
    .values({ name: "Alice", facebookId: "fb-a" })
    .returning({ id: members.id });
  return m.id;
}

async function seedSession(opts: {
  status?: "voting" | "confirmed" | "completed" | "cancelled";
  voteDeadline?: string | null;
}) {
  const [s] = await testDb
    .insert(sessions)
    .values({
      date: "2026-06-01",
      status: opts.status ?? "voting",
      voteDeadline: opts.voteDeadline ?? null,
    })
    .returning({ id: sessions.id });
  return s.id;
}

// Generate local-time ISO strings (YYYY-MM-DDTHH:MM:SS, no Z) — matches the
// stored format (Vietnam local time convention, see design spec). Using
// toISOString().slice(0,19) would produce UTC strings which, on non-UTC
// machines, are parsed back as local time and can appear in the wrong direction.
const futureIso = () =>
  formatLocalDeadline(new Date(Date.now() + 60 * 60 * 1000));
const pastIso = () =>
  formatLocalDeadline(new Date(Date.now() - 60 * 60 * 1000));

describe("submitVote — vote deadline gate", () => {
  beforeEach(reset);

  it("accepts vote when deadline is in the future", async () => {
    const aliceId = await seedMember();
    const sessionId = await seedSession({ voteDeadline: futureIso() });
    userMock.getUserFromCookie.mockResolvedValue({
      memberId: aliceId,
      externalId: "fb-a",
    });

    const r = await submitVote(sessionId, true, false, 0, 0);
    expect("error" in r).toBe(false);
  });

  it("accepts vote when deadline is null (no deadline)", async () => {
    const aliceId = await seedMember();
    const sessionId = await seedSession({ voteDeadline: null });
    userMock.getUserFromCookie.mockResolvedValue({
      memberId: aliceId,
      externalId: "fb-a",
    });

    const r = await submitVote(sessionId, true, false, 0, 0);
    expect("error" in r).toBe(false);
  });

  it("rejects vote when deadline has passed", async () => {
    const aliceId = await seedMember();
    const sessionId = await seedSession({ voteDeadline: pastIso() });
    userMock.getUserFromCookie.mockResolvedValue({
      memberId: aliceId,
      externalId: "fb-a",
    });

    const r = await submitVote(sessionId, true, false, 0, 0);
    expect("error" in r).toBe(true);
  });

  it("rejects edit (update) of existing vote when deadline has passed", async () => {
    const aliceId = await seedMember();
    const sessionId = await seedSession({ voteDeadline: futureIso() });
    userMock.getUserFromCookie.mockResolvedValue({
      memberId: aliceId,
      externalId: "fb-a",
    });

    const r1 = await submitVote(sessionId, true, false, 0, 0);
    expect("error" in r1).toBe(false);

    await testDb
      .update(sessions)
      .set({ voteDeadline: pastIso() })
      .where(eq(sessions.id, sessionId));

    const r2 = await submitVote(sessionId, true, true, 1, 0);
    expect("error" in r2).toBe(true);
  });
});

describe("setVoteDeadline — admin actions", () => {
  beforeEach(reset);

  it("sets a future deadline", async () => {
    const sessionId = await seedSession({ voteDeadline: null });
    const future = futureIso();
    const r = await setVoteDeadline(sessionId, future);
    expect("error" in r).toBe(false);
    const s = await testDb.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });
    expect(s?.voteDeadline).toBe(future);
  });

  it("clears deadline when given null", async () => {
    const sessionId = await seedSession({ voteDeadline: futureIso() });
    const r = await setVoteDeadline(sessionId, null);
    expect("error" in r).toBe(false);
    const s = await testDb.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });
    expect(s?.voteDeadline).toBeNull();
  });

  it("rejects past deadline", async () => {
    const sessionId = await seedSession({ voteDeadline: null });
    const r = await setVoteDeadline(sessionId, pastIso());
    expect("error" in r).toBe(true);
  });

  it("rejects malformed deadline string", async () => {
    const sessionId = await seedSession({ voteDeadline: null });
    const r = await setVoteDeadline(sessionId, "not-a-date");
    expect("error" in r).toBe(true);
  });
});

describe("extendVoteDeadline — quick buttons", () => {
  beforeEach(reset);

  it("extends a future deadline by N hours", async () => {
    const sessionId = await seedSession({ voteDeadline: null });
    const baseMs = Date.now() + 30 * 60 * 1000;
    const baseIso = formatLocalDeadline(new Date(baseMs));
    await testDb
      .update(sessions)
      .set({ voteDeadline: baseIso })
      .where(eq(sessions.id, sessionId));

    const r = await extendVoteDeadline(sessionId, 2);
    expect("error" in r).toBe(false);

    const s = await testDb.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });
    const expectedMs = baseMs + 2 * 60 * 60 * 1000;
    const actualMs = new Date(s!.voteDeadline!).getTime();
    expect(Math.abs(actualMs - expectedMs)).toBeLessThan(5_000);
  });

  it("pushes from NOW when current deadline is in the past", async () => {
    const sessionId = await seedSession({ voteDeadline: pastIso() });
    const beforeMs = Date.now();
    const r = await extendVoteDeadline(sessionId, 2);
    expect("error" in r).toBe(false);

    const s = await testDb.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });
    const newMs = new Date(s!.voteDeadline!).getTime();
    expect(newMs).toBeGreaterThan(beforeMs + 2 * 60 * 60 * 1000 - 5_000);
    expect(newMs).toBeLessThan(beforeMs + 2 * 60 * 60 * 1000 + 5_000);
  });

  it("works when current deadline is null (pushes from now)", async () => {
    const sessionId = await seedSession({ voteDeadline: null });
    const beforeMs = Date.now();
    const r = await extendVoteDeadline(sessionId, 24);
    expect("error" in r).toBe(false);

    const s = await testDb.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });
    const newMs = new Date(s!.voteDeadline!).getTime();
    expect(newMs).toBeGreaterThan(beforeMs + 24 * 60 * 60 * 1000 - 5_000);
    expect(newMs).toBeLessThan(beforeMs + 24 * 60 * 60 * 1000 + 5_000);
  });

  it("rejects hours other than 2 or 24", async () => {
    const sessionId = await seedSession({ voteDeadline: null });
    const r = await extendVoteDeadline(sessionId, 5 as 2 | 24);
    expect("error" in r).toBe(true);
  });
});

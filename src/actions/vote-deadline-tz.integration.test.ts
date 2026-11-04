/**
 * Hạn vote trên server UTC (Vercel). Hạn lưu theo giờ VN không offset, nên mọi
 * phép so sánh phải ghim +07:00. Trước bản sửa, `extendVoteDeadline` đọc hạn
 * bằng `new Date()` theo múi giờ máy và lệch 7 tiếng.
 */
process.env.TZ = "UTC";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members, notifications, sessions, votes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { nowDeadlineVN, parseVoteDeadline } from "@/lib/vote-deadline";
import { isVoteOpen } from "@/lib/session-status";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
}));
vi.mock("@/lib/messenger", () => ({
  sendGroupMessage: vi.fn(),
  buildNewSessionMessage: vi.fn(() => ""),
  buildConfirmedMessage: vi.fn(() => ""),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { extendVoteDeadline, setVoteDeadline } = await import("./sessions");
const { enableNotificationsForTest } =
  await import("@/lib/notifications/test-helpers");

const HOUR = 3_600_000;

afterAll(() => {
  delete process.env.TZ;
});

beforeEach(async () => {
  for (const t of ["notifications", "votes", "sessions", "members"]) {
    await client.execute(`DELETE FROM ${t}`);
  }
  await client.execute("DELETE FROM app_settings");
  await enableNotificationsForTest(testDb);
});

async function seed(voteDeadline: string | null) {
  const [voter] = await testDb
    .insert(members)
    .values({ name: "Voter", facebookId: "fb-voter" })
    .returning({ id: members.id });
  const [idle] = await testDb
    .insert(members)
    .values({ name: "Idle", facebookId: "fb-idle" })
    .returning({ id: members.id });
  const [s] = await testDb
    .insert(sessions)
    .values({ date: "2026-11-20", status: "voting", voteDeadline })
    .returning({ id: sessions.id });
  await testDb
    .insert(votes)
    .values({ sessionId: s.id, memberId: voter.id, willPlay: true });
  return { sid: s.id, voter: voter.id, idle: idle.id };
}

async function reopenedFor() {
  const rows = await testDb
    .select({ recipientId: notifications.recipientId })
    .from(notifications)
    .where(eq(notifications.kind, "vote_reopened"));
  return rows.map((r) => r.recipientId);
}

describe("vote deadline on a UTC server", () => {
  it("runs in UTC", () => {
    expect(new Date().getTimezoneOffset()).toBe(0);
  });

  it("TZ=UTC: extending a vote closed 3h ago by 2h reopens it until now+2h VN and notifies", async () => {
    const { sid, idle } = await seed(
      nowDeadlineVN(new Date(Date.now() - 3 * HOUR)),
    );
    const before = Date.now();
    const r = await extendVoteDeadline(sid, 2);
    expect("error" in r).toBe(false);

    const s = await testDb.query.sessions.findFirst({
      where: eq(sessions.id, sid),
    });
    const newMs = parseVoteDeadline(s!.voteDeadline!).getTime();
    expect(Math.abs(newMs - (before + 2 * HOUR))).toBeLessThan(5_000);
    expect(
      isVoteOpen({ status: "voting", voteDeadline: s!.voteDeadline }),
    ).toEqual({ open: true });
    expect(await reopenedFor()).toEqual([idle]);
  });

  it("extending an open deadline pushes from the current deadline in VN time", async () => {
    const base = Date.now() + 5 * HOUR;
    const { sid } = await seed(nowDeadlineVN(new Date(base)));
    const r = await extendVoteDeadline(sid, 24);
    expect("error" in r).toBe(false);
    const newMs = parseVoteDeadline(
      (r as { voteDeadline: string }).voteDeadline,
    ).getTime();
    expect(Math.abs(newMs - (base + 24 * HOUR))).toBeLessThan(5_000);
  });

  it("setVoteDeadline rejects a deadline that passed 3h ago in VN time", async () => {
    const { sid } = await seed(null);
    const r = await setVoteDeadline(
      sid,
      nowDeadlineVN(new Date(Date.now() - 3 * HOUR)),
    );
    expect(r).toEqual({ error: "deadlineMustBeFuture" });
    expect(await reopenedFor()).toEqual([]);
  });

  it("setVoteDeadline reopening a closed vote with a VN-future deadline notifies who has not voted", async () => {
    const { sid, idle } = await seed(
      nowDeadlineVN(new Date(Date.now() - HOUR)),
    );
    const r = await setVoteDeadline(
      sid,
      nowDeadlineVN(new Date(Date.now() + HOUR)),
    );
    expect(r).toEqual({ success: true });
    expect(await reopenedFor()).toEqual([idle]);
  });
});

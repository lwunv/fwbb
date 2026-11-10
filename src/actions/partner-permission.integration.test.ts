/**
 * "Cho đi 2 mình" là QUYỀN do admin cấp (cột members.default_with_partner,
 * yêu cầu user 6/11/2026). Member chưa được cho thì không vote đi 2 mình và
 * không tự cấp quyền qua trang cá nhân.
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
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
  getAdminFromCookie: vi.fn(async () => ({ sub: "1", role: "admin" })),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { submitVote, adminSetPartner } = await import("./votes");
const { updateMyProfile } = await import("./members");

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

async function seedMember(allowed: boolean) {
  const [m] = await testDb
    .insert(members)
    .values({ name: "Lan", facebookId: "fb-lan", defaultWithPartner: allowed })
    .returning({ id: members.id });
  userMock.getUserFromCookie.mockResolvedValue({
    memberId: m.id,
    externalId: "fb-lan",
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

describe("quyền đi 2 mình", () => {
  beforeEach(reset);

  it("member chưa được cho đi 2 mình vote đi 2 mình → error, không có phiếu", async () => {
    const id = await seedMember(false);
    const s = await seedSession();
    const r = await submitVote(s, true, false, 0, 0, true);
    expect("error" in r).toBe(true);
    expect(await voteOf(s, id)).toBeUndefined();
  });

  it("member chưa được cho vẫn vote 1 mình bình thường", async () => {
    const id = await seedMember(false);
    const s = await seedSession();
    const r = await submitVote(s, true, false, 0, 0, false);
    expect("error" in r).toBe(false);
    expect((await voteOf(s, id))?.withPartner).toBe(false);
  });

  it("member được cho đi 2 mình → vote đi 2 mình được", async () => {
    const id = await seedMember(true);
    const s = await seedSession();
    const r = await submitVote(s, true, false, 0, 0, true);
    expect("error" in r).toBe(false);
    expect((await voteOf(s, id))?.withPartner).toBe(true);
  });

  it("admin vẫn bật đi 2 mình hộ member chưa được cho", async () => {
    const id = await seedMember(false);
    const s = await seedSession();
    await testDb
      .insert(votes)
      .values({ sessionId: s, memberId: id, willPlay: true, willDine: false });
    const r = await adminSetPartner(s, id, true);
    expect(r && "error" in r).toBe(false);
    expect((await voteOf(s, id))?.withPartner).toBe(true);
  });

  it("member gửi withPartner=1 ở trang cá nhân → không tự cấp được quyền", async () => {
    const id = await seedMember(false);
    const fd = new FormData();
    fd.set("nickname", "Lan");
    fd.set("withPartner", "1");
    await updateMyProfile(null, fd);
    const m = await testDb.query.members.findFirst({
      where: eq(members.id, id),
    });
    expect(m?.defaultWithPartner).toBe(false);
  });

  it("member đã được cho, lưu trang cá nhân (không gửi withPartner) → vẫn giữ quyền", async () => {
    const id = await seedMember(true);
    const fd = new FormData();
    fd.set("nickname", "Lan");
    await updateMyProfile(null, fd);
    const m = await testDb.query.members.findFirst({
      where: eq(members.id, id),
    });
    expect(m?.defaultWithPartner).toBe(true);
  });
});

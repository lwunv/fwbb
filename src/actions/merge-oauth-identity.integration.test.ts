/**
 * Multi-SSO: gộp tài khoản đăng nhập khi merge member.
 *
 * - mergeMember (2 member đã approved) phải chuyển MỌI identity OAuth của source
 *   sang target, và tạo identity từ cột legacy nếu chưa có row → sau merge target
 *   đăng nhập được bằng cả 2 tài khoản Google.
 * - approveAndMergeMember (pending → target) KHÔNG còn bị guard chặn khi cả hai
 *   đều có Google; pending's Google trở thành identity phụ của target.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members, memberOauthIdentities, admins } from "@/db/schema";
import { eq } from "drizzle-orm";

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
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/user-identity", () => ({
  getUserFromCookie: vi.fn(async () => null),
  clearUserCookie: vi.fn(),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { mergeMember } = await import("./members");
const { approveAndMergeMember } = await import("./member-approval");
const { findMemberByOAuth, ensureOAuthIdentity } =
  await import("@/lib/oauth-identity");

async function reset() {
  await client.execute("DELETE FROM member_oauth_identities");
  await client.execute("DELETE FROM financial_transactions");
  await client.execute("DELETE FROM session_debts");
  await client.execute("DELETE FROM votes");
  await client.execute("DELETE FROM session_attendees");
  await client.execute("DELETE FROM admins");
  await client.execute("DELETE FROM members");
}

async function seedAdmin() {
  const [m] = await testDb
    .insert(members)
    .values({ name: "Admin" })
    .returning({ id: members.id });
  const [a] = await testDb
    .insert(admins)
    .values({ username: "Admin", passwordHash: "x", memberId: m.id })
    .returning({ id: admins.id });
  vi.mocked(requireAdmin).mockResolvedValue({
    admin: { sub: String(a.id), role: "admin" },
  } as never);
}

describe("multi-SSO merge folds OAuth identities", () => {
  beforeEach(reset);

  it("mergeMember re-points source identities + keeps target's → both Googles resolve to target", async () => {
    await seedAdmin();
    const [source, target] = await testDb
      .insert(members)
      .values([
        { name: "Phiêu-src", googleId: "g-src", email: "src@x.com" },
        { name: "Phiêu-tgt", googleId: "g-tgt", email: "tgt@x.com" },
      ])
      .returning({ id: members.id });
    // Backfill identity rows (simulate lazy-link/backfill đã chạy).
    await ensureOAuthIdentity({
      memberId: source.id,
      provider: "google",
      uid: "g-src",
    });
    await ensureOAuthIdentity({
      memberId: target.id,
      provider: "google",
      uid: "g-tgt",
    });

    const r = await mergeMember(source.id, target.id);
    expect("error" in r).toBe(false);

    const bySrc = await findMemberByOAuth("google", "g-src");
    const byTgt = await findMemberByOAuth("google", "g-tgt");
    expect(bySrc?.id).toBe(target.id);
    expect(byTgt?.id).toBe(target.id);

    // Source member deleted; both identity rows now point to target.
    const srcMember = await testDb.query.members.findFirst({
      where: eq(members.id, source.id),
    });
    expect(srcMember).toBeUndefined();
    const ids = await testDb.query.memberOauthIdentities.findMany({
      where: eq(memberOauthIdentities.memberId, target.id),
    });
    expect(ids.map((i) => i.providerUid).sort()).toEqual(["g-src", "g-tgt"]);
  });

  it("mergeMember creates identity from source legacy column when no identity row exists", async () => {
    await seedAdmin();
    const [source, target] = await testDb
      .insert(members)
      .values([
        { name: "Legacy-src", googleId: "g-legacy" },
        { name: "Legacy-tgt" },
      ])
      .returning({ id: members.id });
    // No ensureOAuthIdentity for source → simulate pre-backfill row.

    const r = await mergeMember(source.id, target.id);
    expect("error" in r).toBe(false);

    const found = await findMemberByOAuth("google", "g-legacy");
    expect(found?.id).toBe(target.id);
    const rows = await testDb.query.memberOauthIdentities.findMany({
      where: eq(memberOauthIdentities.providerUid, "g-legacy"),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].memberId).toBe(target.id);
  });

  it("approveAndMergeMember allows merge when BOTH have Google (guard relaxed)", async () => {
    await seedAdmin();
    const [pending] = await testDb
      .insert(members)
      .values({
        name: "Pending Google",
        googleId: "g-pend",
        approvalStatus: "pending",
      })
      .returning({ id: members.id });
    const [target] = await testDb
      .insert(members)
      .values({
        name: "Approved Google",
        googleId: "g-tgt2",
        approvalStatus: "approved",
      })
      .returning({ id: members.id });
    await ensureOAuthIdentity({
      memberId: pending.id,
      provider: "google",
      uid: "g-pend",
    });
    await ensureOAuthIdentity({
      memberId: target.id,
      provider: "google",
      uid: "g-tgt2",
    });

    const r = await approveAndMergeMember(pending.id, target.id);
    expect("error" in r).toBe(false);

    // Pending deleted, both Googles resolve to target.
    const pendingMember = await testDb.query.members.findFirst({
      where: eq(members.id, pending.id),
    });
    expect(pendingMember).toBeUndefined();
    expect((await findMemberByOAuth("google", "g-pend"))?.id).toBe(target.id);
    expect((await findMemberByOAuth("google", "g-tgt2"))?.id).toBe(target.id);

    const tgt = await testDb.query.members.findFirst({
      where: eq(members.id, target.id),
    });
    expect(tgt?.approvalStatus).toBe("approved");
  });
});
